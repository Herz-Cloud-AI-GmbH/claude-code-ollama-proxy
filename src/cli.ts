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
import { parseLogLevel } from "./logger.js";
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
  .option(
    "--log-level <level>",
    "Log level: error | warn | info | debug (default: info, or debug when --verbose is used)",
    process.env.LOG_LEVEL ?? "",
  )
  .option(
    "--no-sequential-tools",
    "Disable rewriting parallel tool calls into sequential rounds (enabled by default)",
  )
  .option("-v, --verbose", "Enable verbose request/response logging (equivalent to --log-level debug)", false)
  .option(
    "--log-file <path>",
    "Write NDJSON log records to this file in addition to stdout. File is truncated on each start.",
    process.env.LOG_FILE ?? "",
  )
  .action((options: {
    config?: string;
    init: boolean;
    port: number;
    ollamaUrl: string;
    modelMap: ModelMap;
    defaultModel: string;
    strictThinking: boolean;
    sequentialTools: boolean;
    logLevel: string;
    verbose: boolean;
    logFile: string;
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
        logLevel: options.logLevel || undefined,
      });
      console.log(`Created config file: ${dest}`);
      console.log("Edit it, then run: claude-code-ollama-proxy");
      process.exit(0);
    }

    // ── Resolve effective log level ────────────────────────────────────────
    // Only set an explicit level when the user has been intentional:
    //   • --log-level flag (or LOG_LEVEL env var read as its default)
    //   • --verbose shorthand
    // When neither is given, leave logLevel undefined so that a value in
    // proxy.config.json (merged below) can win, and server.ts will fall back
    // to "info" if the file also has nothing.
    let effectiveLogLevel: ProxyConfig["logLevel"];
    if (options.logLevel) {
      // options.logLevel is non-empty — may come from --log-level flag or
      // from the LOG_LEVEL env var (used as the Commander default).
      // parseLogLevel validates and throws on bad input.
      try {
        effectiveLogLevel = parseLogLevel(options.logLevel);
      } catch (err) {
        console.error(String(err));
        process.exit(1);
      }
    } else if (options.verbose) {
      effectiveLogLevel = "debug";
    }
    // else: undefined — mergeConfig will use the file's logLevel if present

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
      sequentialToolCalls: options.sequentialTools ?? true,
      verbose: options.verbose,
      logLevel: effectiveLogLevel,
      logFile: options.logFile || undefined,
    });

    const app = createServer(config);

    const server = app.listen(config.port, () => {
      const mapEntries = Object.entries(config.modelMap);
      const effectiveLevel = config.logLevel ?? (config.verbose ? "debug" : "info");
      const W = 54;
      const bar  = "─".repeat(W);
      const dbar = "═".repeat(W);

      const pad = (s: string) => `  ${s}`;
      const kv  = (key: string, val: string) =>
        pad(`${key.padEnd(20)}  ${val}`);

      console.log("");
      console.log(`╔${dbar}╗`);
      console.log(`║${"  claude-code-ollama-proxy".padEnd(W)}║`);
      console.log(`╚${dbar}╝`);
      console.log("");
      console.log(kv("Listening",    `http://localhost:${config.port}`));
      console.log(kv("Ollama",       config.ollamaUrl));
      console.log(kv("Default model",config.defaultModel));
      console.log(kv("Log level",    effectiveLevel));
      if (config.logFile) {
        console.log(kv("Log file",   config.logFile));
      }
      if (configFilePath) {
        console.log(kv("Config file", configFilePath));
      }

      if (mapEntries.length > 0) {
        console.log("");
        console.log(pad("Model map  (Claude → Ollama)"));
        for (const [k, v] of mapEntries) {
          console.log(pad(`  ${k.padEnd(38)} →  ${v}`));
        }
      }

      console.log("");
      console.log(pad(`─── Quick start ${"─".repeat(W - 15)}`));
      console.log(pad(`ANTHROPIC_BASE_URL=http://localhost:${config.port} \\`));
      console.log(pad(`ANTHROPIC_MODEL=${config.defaultModel} \\`));
      console.log(pad("claude"));

      console.log("");
      console.log(pad(`─── Extended Thinking ${"─".repeat(W - 21)}`));
      if (config.strictThinking) {
        console.log(pad("Strict mode — non-thinking models return HTTP 400."));
      } else {
        console.log(pad("thinking field is silently stripped for non-thinking models."));
        console.log(pad("Capable prefixes: qwen3, deepseek-r1, magistral, nemotron, glm4, qwq"));
      }

      console.log("");
      console.log(pad(`─── Tips ${"─".repeat(W - 8)}`));
      if (config.logFile) {
        console.log(pad(`Logs → stdout  +  ${config.logFile}  (truncated each start)`));
        console.log(pad(`  tail -f ${config.logFile} | jq -r '"[\\(.SeverityText)] \\(.Body)"'`));
      } else {
        console.log(pad("Logs → stdout only.  Add --log-file proxy.log to also write a file."));
      }
      if (!configFilePath) {
        console.log(pad(`Run with --init to generate a ${CONFIG_FILE_NAME} config file.`));
      }

      console.log("");
      console.log(`  ${bar}`);
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
