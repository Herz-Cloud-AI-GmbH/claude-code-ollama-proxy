import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import {
  OllamaConnectionError,
  OllamaResponseError,
  ollamaChat,
  ollamaChatStream,
  ollamaListModels,
} from "./ollama-client.js";
import { anthropicToOllama, generateMessageId, ollamaToAnthropic } from "./translator.js";
import { createStreamTransformer, parseOllamaNDJSON } from "./streaming.js";
import type { AnthropicError, AnthropicRequest, ProxyConfig } from "./types.js";

export function createServer(config: ProxyConfig) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  if (config.verbose) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`[proxy] ${req.method} ${req.path}`);
      next();
    });
  }

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
      handleError(err, res);
    }
  });

  // ─── Messages (core proxy endpoint) ───────────────────────────────────────
  app.post("/v1/messages", async (req: Request, res: Response) => {
    const anthropicReq = req.body as AnthropicRequest;

    if (config.verbose) {
      console.log("[proxy] Anthropic request:", JSON.stringify(anthropicReq, null, 2));
    }

    const ollamaReq = anthropicToOllama(
      anthropicReq,
      config.modelMap,
      config.defaultModel,
    );

    if (config.verbose) {
      console.log("[proxy] Ollama request:", JSON.stringify(ollamaReq, null, 2));
    }

    try {
      if (anthropicReq.stream) {
        await handleStreaming(anthropicReq, ollamaReq.model, ollamaReq, config, res);
      } else {
        await handleNonStreaming(anthropicReq, ollamaReq.model, ollamaReq, config, res);
      }
    } catch (err) {
      handleError(err, res);
    }
  });

  // ─── Global error handler ──────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    handleError(err, res);
  });

  return app;
}

async function handleNonStreaming(
  anthropicReq: AnthropicRequest,
  requestedModel: string,
  ollamaReq: ReturnType<typeof anthropicToOllama>,
  config: ProxyConfig,
  res: Response,
) {
  const ollamaRes = await ollamaChat(config.ollamaUrl, ollamaReq);

  if (config.verbose) {
    console.log("[proxy] Ollama response:", JSON.stringify(ollamaRes, null, 2));
  }

  const anthropicRes = ollamaToAnthropic(ollamaRes, anthropicReq.model);
  res.json(anthropicRes);
}

async function handleStreaming(
  anthropicReq: AnthropicRequest,
  requestedModel: string,
  ollamaReq: ReturnType<typeof anthropicToOllama>,
  config: ProxyConfig,
  res: Response,
) {
  const messageId = generateMessageId();

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const ollamaResponse = await ollamaChatStream(config.ollamaUrl, ollamaReq);

  if (!ollamaResponse.body) {
    throw new Error("Ollama returned no response body");
  }

  const transform = createStreamTransformer(messageId, anthropicReq.model, 0);
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
        if (config.verbose) {
          console.log("[proxy] Ollama chunk:", JSON.stringify(chunk));
        }
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

function handleError(err: unknown, res: Response) {
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

  const errorResponse: AnthropicError = {
    type: "error",
    error: { type: errorType, message },
  };

  res.status(statusCode).json(errorResponse);
}
