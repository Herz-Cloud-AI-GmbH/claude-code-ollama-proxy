#!/usr/bin/env node
import { Command } from "commander";
import { createServer } from "./server.js";
import { DEFAULT_MODEL_MAP } from "./translator.js";
import type { ModelMap, ProxyConfig } from "./types.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "../package.json"), "utf-8"),
    ) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

function parseModelMap(value: string, previous: ModelMap): ModelMap {
  // Accept JSON string: '{"claude-3-5-sonnet-20241022":"llama3.1:8b"}'
  if (value.startsWith("{")) {
    try {
      return { ...previous, ...(JSON.parse(value) as ModelMap) };
    } catch {
      throw new Error(`Invalid JSON for --model-map: ${value}`);
    }
  }
  // Accept key=value pair: claude-3-5-sonnet-20241022=llama3.1:8b
  const eqIdx = value.indexOf("=");
  if (eqIdx === -1) {
    throw new Error(`Invalid --model-map entry (expected key=value): ${value}`);
  }
  const key = value.substring(0, eqIdx);
  const val = value.substring(eqIdx + 1);
  return { ...previous, [key]: val };
}

const program = new Command();

program
  .name("claude-code-ollama-proxy")
  .description(
    "Proxy server that translates Anthropic Claude API requests to Ollama.\n" +
      "Allows Claude Code and other Anthropic-API clients to use local LLMs.",
  )
  .version(loadVersion())
  .option(
    "-p, --port <number>",
    "Port to listen on",
    (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1 || n > 65535) throw new Error("Port must be 1-65535");
      return n;
    },
    parseInt(process.env.PORT ?? "3000", 10),
  )
  .option(
    "-u, --ollama-url <url>",
    "Ollama base URL",
    process.env.OLLAMA_URL ?? "http://localhost:11434",
  )
  .option(
    "-m, --model-map <mapping>",
    'Model mapping as key=value or JSON. Can be repeated. E.g. -m claude-3-5-sonnet-20241022=llama3.1:8b',
    (v, prev) => parseModelMap(v, prev),
    { ...DEFAULT_MODEL_MAP },
  )
  .option(
    "-d, --default-model <model>",
    "Default Ollama model for unmapped Claude models",
    process.env.DEFAULT_MODEL ?? "llama3.1",
  )
  .option("-v, --verbose", "Enable verbose request/response logging", false)
  .action((options: {
    port: number;
    ollamaUrl: string;
    modelMap: ModelMap;
    defaultModel: string;
    verbose: boolean;
  }) => {
    const config: ProxyConfig = {
      port: options.port,
      ollamaUrl: options.ollamaUrl,
      modelMap: options.modelMap,
      defaultModel: options.defaultModel,
      verbose: options.verbose,
    };

    const app = createServer(config);

    const server = app.listen(config.port, () => {
      console.log("╔═══════════════════════════════════════════════╗");
      console.log("║     claude-code-ollama-proxy                  ║");
      console.log("╚═══════════════════════════════════════════════╝");
      console.log(`  Proxy listening on  : http://localhost:${config.port}`);
      console.log(`  Forwarding to Ollama: ${config.ollamaUrl}`);
      console.log(`  Default model       : ${config.defaultModel}`);
      console.log(`  Verbose logging     : ${config.verbose}`);
      console.log("");
      console.log("  Configure Claude Code:");
      console.log(`    ANTHROPIC_API_KEY=any-value \\`);
      console.log(`    ANTHROPIC_BASE_URL=http://localhost:${config.port} \\`);
      console.log("    claude");
      console.log("");
      console.log("  ⚠  Extended Thinking Support:");
      console.log("     Thinking requests are ONLY accepted for these Ollama model prefixes:");
      console.log("       qwen3, deepseek-r1, magistral, nemotron, glm4, qwq");
      console.log("     Requests with a 'thinking' field for any other model return HTTP 400.");
      console.log("");
    });

    function shutdown(signal: string) {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      server.close(() => {
        console.log("Server closed.");
        process.exit(0);
      });
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  });

program.parse();
