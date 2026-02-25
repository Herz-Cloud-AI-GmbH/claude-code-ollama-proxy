import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import {
  OllamaConnectionError,
  OllamaResponseError,
  ollamaChat,
  ollamaChatStream,
  ollamaListModels,
} from "./ollama-client.js";
import { anthropicToOllama, generateMessageId, mapModel, ollamaToAnthropic } from "./translator.js";
import { buildToolSchemaMap } from "./tool-healing.js";
import { createStreamTransformer, parseOllamaNDJSON } from "./streaming.js";
import { isThinkingCapable, needsThinkingValidation } from "./thinking.js";
import { countRequestTokens } from "./token-counter.js";
import { createLogger, generateRequestId, type Logger } from "./logger.js";
import type { AnthropicError, AnthropicRequest, ProxyConfig, ToolSchemaInfo } from "./types.js";

export function createServer(config: ProxyConfig) {
  // Derive effective log level: explicit > verbose flag > default
  const effectiveLevel = config.logLevel ?? (config.verbose ? "debug" : "info");
  const logger = createLogger({
    level: effectiveLevel,
    serviceName: "claude-code-ollama-proxy",
    serviceVersion: "0.1.0",
    logFile: config.logFile,
    quiet: config.quiet,
  });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  // ─── Request / response logging middleware ──────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = generateRequestId();
    res.locals.requestId = requestId;
    res.locals.startTime = Date.now();

    logger.info("Request received", {
      "http.method": req.method,
      "http.target": req.path,
      "proxy.request_id": requestId,
    });

    res.on("finish", () => {
      const latencyMs = Date.now() - (res.locals.startTime as number);
      logger.info("Request completed", {
        "http.method": req.method,
        "http.target": req.path,
        "http.status_code": res.statusCode,
        "proxy.latency_ms": latencyMs,
        "proxy.request_id": requestId,
      });
    });

    next();
  });

  // ─── Health check ──────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", ollama: config.ollamaUrl });
  });

  // ─── Models list ───────────────────────────────────────────────────────────
  app.get("/v1/models", async (_req: Request, res: Response) => {
    try {
      const modelList = await ollamaListModels(config.ollamaUrl);
      // Return in Anthropic-compatible format
      const data = modelList.models.map((m) => ({
        id: m.name,
        object: "model",
        created: Math.floor(new Date(m.modified_at).getTime() / 1000),
        owned_by: "ollama",
      }));
      res.json({ object: "list", data });
    } catch (err) {
      handleError(err, res, logger);
    }
  });

  // ─── Token count endpoint ─────────────────────────────────────────────────
  app.post("/v1/messages/count_tokens", (req: Request, res: Response) => {
    try {
      const anthropicReq = req.body as AnthropicRequest;
      const inputTokens = countRequestTokens(anthropicReq);
      res.json({ input_tokens: inputTokens });
    } catch (err) {
      handleError(err, res, logger);
    }
  });

  // ─── Messages (core proxy endpoint) ───────────────────────────────────────
  app.post("/v1/messages", async (req: Request, res: Response) => {
    const requestId = res.locals.requestId as string;
    const rawReq = req.body as AnthropicRequest;
    let anthropicReq = rawReq;

    logger.debug("Anthropic request body", {
      "proxy.request_id": requestId,
      "proxy.anthropic_request": anthropicReq,
    });

    // ── Thinking validation ──
    // Claude Code (an AI agent) auto-generates thinking requests. Returning 400
    // would break the session. Default behaviour: strip the thinking field and
    // continue (log a warning). Set config.strictThinking = true to reject with
    // 400 instead (useful during development to catch mis-configuration early).
    if (needsThinkingValidation(anthropicReq)) {
      const ollamaModel = mapModel(anthropicReq.model, config.modelMap, config.defaultModel);
      if (!isThinkingCapable(ollamaModel)) {
        if (config.strictThinking) {
          const errorResponse: AnthropicError = {
            type: "error",
            error: {
              type: "thinking_not_supported",
              message:
                `The model "${ollamaModel}" (mapped from "${anthropicReq.model}") does not support extended thinking. ` +
                `Thinking-capable Ollama models: qwen3, deepseek-r1, magistral, nemotron, glm4, qwq. ` +
                `Remove the "thinking" field, switch to a thinking-capable model, or disable --strict-thinking.`,
            },
          };
          res.status(400).json(errorResponse);
          return;
        }
        logger.warn("Thinking field stripped for non-thinking model", {
          "proxy.request_id": requestId,
          "proxy.ollama_model": ollamaModel,
          "proxy.requested_model": anthropicReq.model,
        });
        anthropicReq = { ...anthropicReq, thinking: undefined };
      }
    }

    const toolSchemaMap = anthropicReq.tools?.length
      ? buildToolSchemaMap(anthropicReq.tools)
      : undefined;

    const ollamaReq = anthropicToOllama(
      anthropicReq,
      config.modelMap,
      config.defaultModel,
      config.sequentialToolCalls,
      toolSchemaMap,
    );

    logger.debug("Ollama request body", {
      "proxy.request_id": requestId,
      "proxy.ollama_request": ollamaReq,
    });

    try {
      if (anthropicReq.stream) {
        await handleStreaming(anthropicReq, ollamaReq, config.ollamaUrl, logger, res, requestId, toolSchemaMap);
      } else {
        await handleNonStreaming(anthropicReq, ollamaReq, config.ollamaUrl, logger, res, requestId, toolSchemaMap);
      }
    } catch (err) {
      handleError(err, res, logger, requestId);
    }
  });

  // ─── Global error handler ──────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    handleError(err, res, logger);
  });

  return app;
}

async function handleNonStreaming(
  anthropicReq: AnthropicRequest,
  ollamaReq: ReturnType<typeof anthropicToOllama>,
  ollamaUrl: string,
  logger: Logger,
  res: Response,
  requestId: string,
  toolSchemaMap?: Map<string, ToolSchemaInfo>,
) {
  const ollamaRes = await ollamaChat(ollamaUrl, ollamaReq);

  logger.debug("Ollama response body", {
    "proxy.request_id": requestId,
    "proxy.ollama_response": ollamaRes,
  });

  const { response: anthropicRes, renames, coercions } = ollamaToAnthropic(
    ollamaRes, anthropicReq.model, undefined, toolSchemaMap,
  );

  if (renames.length > 0) {
    logger.warn("Healed tool parameter names", {
      "proxy.request_id": requestId,
      "proxy.param_renames": renames,
    });
  }

  if (coercions.length > 0) {
    logger.warn("Healed tool parameter types", {
      "proxy.request_id": requestId,
      "proxy.param_coercions": coercions,
    });
  }

  res.json(anthropicRes);
}

async function handleStreaming(
  anthropicReq: AnthropicRequest,
  ollamaReq: ReturnType<typeof anthropicToOllama>,
  ollamaUrl: string,
  logger: Logger,
  res: Response,
  requestId: string,
  toolSchemaMap?: Map<string, ToolSchemaInfo>,
) {
  const messageId = generateMessageId();

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const ollamaResponse = await ollamaChatStream(ollamaUrl, ollamaReq);

  if (!ollamaResponse.body) {
    throw new Error("Ollama returned no response body");
  }

  const transform = createStreamTransformer(messageId, anthropicReq.model, 0, toolSchemaMap);
  const reader = ollamaResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { chunks, remaining } = parseOllamaNDJSON(buffer);
      buffer = remaining;

      for (const chunk of chunks) {
        logger.debug("Ollama stream chunk", {
          "proxy.request_id": requestId,
          "proxy.stream_chunk": chunk,
        });
        const sseEvents = transform(chunk);
        for (const event of sseEvents) {
          res.write(event);
        }
      }
    }

    // Process any remaining buffer content
    if (buffer.trim()) {
      const { chunks } = parseOllamaNDJSON(buffer + "\n");
      for (const chunk of chunks) {
        const sseEvents = transform(chunk);
        for (const event of sseEvents) {
          res.write(event);
        }
      }
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}

function handleError(err: unknown, res: Response, logger?: Logger, requestId?: string) {
  if (res.headersSent) {
    // For streaming, we can't send a proper error response
    res.end();
    return;
  }

  let statusCode = 500;
  let errorType = "api_error";
  let message = "An internal error occurred";

  if (err instanceof OllamaConnectionError) {
    statusCode = 502;
    errorType = "api_connection_error";
    message = err.message;
  } else if (err instanceof OllamaResponseError) {
    statusCode = err.status >= 400 && err.status < 500 ? err.status : 502;
    errorType = "api_error";
    message = err.message;
  } else if (err instanceof Error) {
    message = err.message;
  }

  logger?.error("Request error", {
    "proxy.request_id": requestId,
    "error.type": errorType,
    "error.message": message,
    "http.status_code": statusCode,
  });

  const errorResponse: AnthropicError = {
    type: "error",
    error: { type: errorType, message },
  };

  res.status(statusCode).json(errorResponse);
}

