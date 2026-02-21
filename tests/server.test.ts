import { createServer as createHttpServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import type { ProxyConfig } from "../src/types.js";

// ─── Mock Ollama Server ────────────────────────────────────────────────────

const NON_STREAM_RESPONSE = {
  model: "llama3.1:8b",
  created_at: "2024-01-01T00:00:00Z",
  message: { role: "assistant", content: "Hello from Ollama!" },
  done: true,
  done_reason: "stop",
  eval_count: 8,
  prompt_eval_count: 15,
};

const STREAM_CHUNKS = [
  { model: "llama3.1:8b", created_at: "2024-01-01T00:00:00Z", message: { role: "assistant", content: "Hello" }, done: false },
  { model: "llama3.1:8b", created_at: "2024-01-01T00:00:00Z", message: { role: "assistant", content: " world" }, done: false },
  { model: "llama3.1:8b", created_at: "2024-01-01T00:00:00Z", message: { role: "assistant", content: "" }, done: true, done_reason: "stop", eval_count: 12, prompt_eval_count: 20 },
];

const MODEL_LIST = {
  models: [
    { name: "llama3.1:8b", modified_at: "2024-01-01T00:00:00Z", size: 4000000000, digest: "abc123" },
    { name: "mistral:latest", modified_at: "2024-01-01T00:00:00Z", size: 3000000000, digest: "def456" },
  ],
};

let mockOllamaServer: ReturnType<typeof createHttpServer>;
let mockOllamaPort: number;

function startMockOllama(): Promise<void> {
  return new Promise((resolve) => {
    mockOllamaServer = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        if (req.url === "/api/tags") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(MODEL_LIST));
          return;
        }

        if (req.url === "/api/chat") {
          let parsed: { stream?: boolean } = {};
          try { parsed = JSON.parse(body) as { stream?: boolean }; } catch { /* */ }

          if (parsed.stream) {
            res.writeHead(200, { "Content-Type": "application/x-ndjson" });
            let idx = 0;
            function sendNext() {
              if (idx >= STREAM_CHUNKS.length) {
                res.end();
                return;
              }
              res.write(JSON.stringify(STREAM_CHUNKS[idx]) + "\n");
              idx++;
              setTimeout(sendNext, 5);
            }
            sendNext();
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(NON_STREAM_RESPONSE));
          }
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      });
    });

    mockOllamaServer.listen(0, "127.0.0.1", () => {
      const addr = mockOllamaServer.address();
      mockOllamaPort = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
  });
}

// ─── Proxy Server Setup ───────────────────────────────────────────────────

let proxyPort: number;
let proxyBaseUrl: string;

const config: ProxyConfig = {
  port: 0,
  ollamaUrl: "", // filled in beforeAll
  modelMap: { "claude-3-5-sonnet-20241022": "llama3.1:8b" },
  defaultModel: "llama3.1",
  verbose: false,
};

let httpServer: ReturnType<typeof import("node:http").createServer>;

beforeAll(async () => {
  await startMockOllama();
  config.ollamaUrl = `http://127.0.0.1:${mockOllamaPort}`;

  const app = createServer(config);
  await new Promise<void>((resolve) => {
    httpServer = app.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address();
      proxyPort = typeof addr === "object" && addr ? addr.port : 0;
      proxyBaseUrl = `http://127.0.0.1:${proxyPort}`;
      resolve();
    });
  });
});

afterAll(() => {
  httpServer.close();
  mockOllamaServer.close();
});

// ─── Helper ───────────────────────────────────────────────────────────────

async function postMessages(body: object): Promise<Response> {
  return fetch(`${proxyBaseUrl}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await fetch(`${proxyBaseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; ollama: string };
    expect(body.status).toBe("ok");
    expect(body.ollama).toContain("127.0.0.1");
  });
});

describe("GET /v1/models", () => {
  it("returns 200 with a list of models", async () => {
    const res = await fetch(`${proxyBaseUrl}/v1/models`);
    expect(res.status).toBe(200);
    const body = await res.json() as { object: string; data: { id: string }[] };
    expect(body.object).toBe("list");
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("id");
  });
});

describe("POST /v1/messages (non-streaming)", () => {
  it("returns a valid Anthropic message response", async () => {
    const res = await postMessages({
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 100,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      type: string;
      role: string;
      content: { type: string; text: string }[];
      usage: { input_tokens: number; output_tokens: number };
      stop_reason: string;
      id: string;
    };
    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.content[0].type).toBe("text");
    expect(body.content[0].text).toBe("Hello from Ollama!");
    expect(body.usage.input_tokens).toBe(15);
    expect(body.usage.output_tokens).toBe(8);
    expect(body.stop_reason).toBe("end_turn");
    expect(body.id).toMatch(/^msg_/);
  });
});

describe("POST /v1/messages (streaming)", () => {
  async function collectSSEEvents(body: object): Promise<{ type: string; data: unknown }[]> {
    const res = await postMessages({ ...body, stream: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events: { type: string; data: unknown }[] = [];

    // Parse SSE format
    const blocks = text.split("\n\n").filter(Boolean);
    for (const block of blocks) {
      const lines = block.split("\n");
      const eventLine = lines.find((l) => l.startsWith("event: "));
      const dataLine = lines.find((l) => l.startsWith("data: "));
      if (eventLine && dataLine) {
        const type = eventLine.replace("event: ", "").trim();
        const data = JSON.parse(dataLine.replace("data: ", "").trim()) as unknown;
        events.push({ type, data });
      }
    }
    return events;
  }

  it("returns text/event-stream content type", async () => {
    const res = await postMessages({
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("stream contains message_start event", async () => {
    const events = await collectSSEEvents({
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(events.some((e) => e.type === "message_start")).toBe(true);
  });

  it("stream contains content_block_start event", async () => {
    const events = await collectSSEEvents({
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(events.some((e) => e.type === "content_block_start")).toBe(true);
  });

  it("stream contains content_block_delta events with text", async () => {
    const events = await collectSSEEvents({
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hello" }],
    });
    const deltas = events.filter((e) => e.type === "content_block_delta");
    expect(deltas.length).toBeGreaterThan(0);
  });

  it("stream contains message_delta event with token counts", async () => {
    const events = await collectSSEEvents({
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hello" }],
    });
    const msgDelta = events.find((e) => e.type === "message_delta") as
      | { type: string; data: { usage: { output_tokens: number } } }
      | undefined;
    expect(msgDelta).toBeDefined();
    expect(msgDelta?.data.usage.output_tokens).toBe(12);
  });

  it("stream contains message_stop event as the last event", async () => {
    const events = await collectSSEEvents({
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(events[events.length - 1].type).toBe("message_stop");
  });

  it("streaming text content matches expected output", async () => {
    const events = await collectSSEEvents({
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hello" }],
    });
    const text = events
      .filter((e) => e.type === "content_block_delta")
      .map((e) => (e.data as { delta: { text: string } }).delta.text)
      .join("");
    expect(text).toBe("Hello world");
  });
});

describe("POST /v1/messages (error handling)", () => {
  it("returns Anthropic error format when Ollama is unreachable", async () => {
    const unreachableConfig: ProxyConfig = {
      ...config,
      ollamaUrl: "http://127.0.0.1:1", // guaranteed unreachable
    };
    const app = createServer(unreachableConfig);
    const testServer = await new Promise<ReturnType<typeof import("node:http").createServer>>(
      (resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      },
    );
    const addr = testServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const body = await res.json() as { type: string; error: { type: string; message: string } };
    expect(body.type).toBe("error");
    expect(body.error).toHaveProperty("type");
    expect(body.error).toHaveProperty("message");

    testServer.close();
  });
});

describe("POST /v1/messages/count_tokens", () => {
  it("returns input_tokens number for a simple request", async () => {
    const res = await fetch(`${proxyBaseUrl}/v1/messages/count_tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Hello world" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { input_tokens: number };
    expect(typeof body.input_tokens).toBe("number");
    expect(body.input_tokens).toBeGreaterThan(0);
  });

  it("includes system prompt tokens in count", async () => {
    const resWithSystem = await fetch(`${proxyBaseUrl}/v1/messages/count_tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        system: "You are an assistant",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    const withSystem = await resWithSystem.json() as { input_tokens: number };

    const resWithout = await fetch(`${proxyBaseUrl}/v1/messages/count_tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    const without = await resWithout.json() as { input_tokens: number };

    expect(withSystem.input_tokens).toBeGreaterThan(without.input_tokens);
  });
});

describe("POST /v1/messages (thinking validation)", () => {
  it("returns 400 when thinking requested for non-thinking model", async () => {
    const res = await postMessages({
      model: "claude-3-5-sonnet-20241022", // maps to llama3.1:8b (non-thinking)
      messages: [{ role: "user", content: "Think hard" }],
      thinking: { type: "enabled", budget_tokens: 5000 },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { type: string; error: { type: string; message: string } };
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("thinking_not_supported");
  });
});
