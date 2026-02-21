#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createServer } from "./server.js";
import { DEFAULT_MODEL_MAP } from "./translator.js";
import {
  CONFIG_FILE_NAME,
  loadConfigFile,
  mergeConfig,
  writeDefaultConfigFile,
} from "./config.js";
import type { ModelMap, ProxyConfig } from "./types.js";

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
    "-c, --config <path>",
    `Path to a proxy config JSON file (default: ${CONFIG_FILE_NAME} in current dir if it exists)`,
  )
  .option(
    "--init",
    `Write a default ${CONFIG_FILE_NAME} config file to the current directory and exit`,
    false,
  )
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
    'Model mapping as key=value or JSON. Can be repeated. E.g. -m claude-sonnet-4-5=qwen3:8b',
    (v, prev) => parseModelMap(v, prev),
    { ...DEFAULT_MODEL_MAP },
  )
  .option(
    "-d, --default-model <model>",
    "Default Ollama model for unmapped Claude models",
    process.env.DEFAULT_MODEL ?? "llama3.1",
  )
  .option(
    "--strict-thinking",
    "Reject thinking requests for non-thinking models with HTTP 400 (default: silently strip thinking field)",
    false,
  )
  .option("-v, --verbose", "Enable verbose request/response logging", false)
  .action((options: {
    config?: string;
    init: boolean;
    port: number;
    ollamaUrl: string;
    modelMap: ModelMap;
    defaultModel: string;
    strictThinking: boolean;
    verbose: boolean;
  }) => {
    // ── --init: write default config file and exit ─────────────────────────
    if (options.init) {
      const dest = resolve(process.cwd(), CONFIG_FILE_NAME);
      if (existsSync(dest)) {
        console.error(`Config file already exists: ${dest}`);
        process.exit(1);
      }
      writeDefaultConfigFile(dest, {
        port: options.port,
        ollamaUrl: options.ollamaUrl,
        defaultModel: options.defaultModel,
        modelMap: options.modelMap,
        strictThinking: options.strictThinking,
        verbose: options.verbose,
      });
      console.log(`Created config file: ${dest}`);
      console.log("Edit it, then run: claude-code-ollama-proxy");
      process.exit(0);
    }

    // ── Resolve config file ────────────────────────────────────────────────
    const configPath = options.config
      ? resolve(process.cwd(), options.config)
      : existsSync(resolve(process.cwd(), CONFIG_FILE_NAME))
        ? resolve(process.cwd(), CONFIG_FILE_NAME)
        : null;

    const fileConfig = configPath ? loadConfigFile(configPath) : null;
    const configFilePath = fileConfig ? configPath : null;

    // ── Merge config: file < env vars < CLI flags ──────────────────────────
    const config: ProxyConfig = mergeConfig(fileConfig, {
      port: options.port,
      ollamaUrl: options.ollamaUrl,
      defaultModel: options.defaultModel,
      modelMap: options.modelMap,
      strictThinking: options.strictThinking,
      verbose: options.verbose,
    });

    const app = createServer(config);

    const server = app.listen(config.port, () => {
      const mapEntries = Object.entries(config.modelMap);
      console.log("╔═══════════════════════════════════════════════╗");
      console.log("║     claude-code-ollama-proxy                  ║");
      console.log("╚═══════════════════════════════════════════════╝");
      console.log(`  Proxy listening on  : http://localhost:${config.port}`);
      console.log(`  Forwarding to Ollama: ${config.ollamaUrl}`);
      console.log(`  Default model       : ${config.defaultModel}`);
      console.log(`  Strict thinking     : ${config.strictThinking}`);
      console.log(`  Verbose logging     : ${config.verbose}`);
      if (configFilePath) {
        console.log(`  Config file         : ${configFilePath}`);
      }
      console.log("");
      if (mapEntries.length > 0) {
        console.log("  Model map (Claude → Ollama):");
        for (const [k, v] of mapEntries) {
          console.log(`    ${k.padEnd(40)} → ${v}`);
        }
        console.log("");
      }
      console.log("  ── AI-agent-first setup (recommended) ─────────");
      console.log("  Set ANTHROPIC_MODEL=<your-ollama-model> in Claude Code.");
      console.log("  The proxy passes non-Claude model names through directly.");
      console.log("");
      console.log("  ── Quick start ─────────────────────────────────");
      console.log("  Option A — AI-agent-first (no model map needed):");
      console.log(`    ANTHROPIC_API_KEY=any-value \\`);
      console.log(`    ANTHROPIC_MODEL=<your-ollama-model> \\`);
      console.log(`    ANTHROPIC_BASE_URL=http://localhost:${config.port} \\`);
      console.log("    claude");
      console.log("");
      console.log("  Option B — use proxy default model:");
      console.log(`    ANTHROPIC_API_KEY=any-value \\`);
      console.log(`    ANTHROPIC_BASE_URL=http://localhost:${config.port} \\`);
      console.log(`    claude  # proxy routes all Claude model names → ${config.defaultModel}`);
      console.log("");
      console.log("  ⚠  Extended Thinking:");
      if (config.strictThinking) {
        console.log("     strict mode — thinking requests for non-thinking models return HTTP 400.");
      } else {
        console.log("     thinking field is SILENTLY STRIPPED for non-thinking models.");
        console.log("     Use --strict-thinking to get HTTP 400 instead.");
      }
      console.log("     Thinking-capable Ollama model prefixes:");
      console.log("       qwen3, deepseek-r1, magistral, nemotron, glm4, qwq");
      if (!configFilePath) {
        console.log("");
        console.log(`  Tip: run with --init to create a ${CONFIG_FILE_NAME} config file.`);
      }
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
