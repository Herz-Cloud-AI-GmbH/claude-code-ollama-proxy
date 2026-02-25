#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
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

const PID_FILE = resolve(process.cwd(), "proxy.pid");

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

const VERSION = loadVersion();
const program = new Command();

program
  .name("claude-code-ollama-proxy")
  .description(
    "Proxy server that translates Anthropic Claude API requests to Ollama.\n" +
      "Allows Claude Code and other Anthropic-API clients to use local LLMs.",
  )
  .version(VERSION)
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
  .option(
    "-b, --background",
    "Start the proxy as a background daemon. Requires --log-file. Parent exits immediately after spawn.",
    false,
  )
  .option(
    "--stop",
    "Stop a previously backgrounded proxy (reads proxy.pid in the current directory)",
    false,
  )
  .option(
    "-q, --quiet",
    "Suppress stdout log output (logs go only to --log-file). Implied by --background.",
    false,
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
    background: boolean;
    stop: boolean;
    quiet: boolean;
  }) => {
    // ── --stop: send SIGTERM to a backgrounded proxy ──────────────────────
    if (options.stop) {
      if (!existsSync(PID_FILE)) {
        console.error("No proxy.pid file found — is the proxy running in background mode?");
        process.exit(1);
      }
      const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
      try {
        process.kill(pid, "SIGTERM");
        console.log(`Sent SIGTERM to proxy (PID ${pid})`);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ESRCH") {
          console.log(`Proxy (PID ${pid}) is not running — removing stale PID file`);
        } else {
          console.error(`Failed to stop proxy (PID ${pid}):`, err);
          process.exit(1);
        }
      }
      try { unlinkSync(PID_FILE); } catch { /* already gone */ }
      process.exit(0);
    }

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

    // ── --background: respawn as detached child and exit parent ────────────
    if (options.background) {
      if (!options.logFile) {
        console.error("--background requires --log-file (logs must go somewhere when stdout is detached)");
        process.exit(1);
      }
      const args = process.argv.slice(2).filter(
        (a) => a !== "--background" && a !== "-b",
      );
      args.push("--quiet");

      const child = spawn(process.execPath, [__filename, ...args], {
        detached: true,
        stdio: "ignore",
        cwd: process.cwd(),
      });
      child.unref();

      if (child.pid) {
        writeFileSync(PID_FILE, String(child.pid) + "\n");
        console.log(`Proxy started in background (PID ${child.pid})`);
        console.log(`  Log file: ${options.logFile}`);
        console.log(`  PID file: ${PID_FILE}`);
        console.log(`  Stop:     node dist/cli.js --stop`);
      }
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
      quiet: options.quiet,
    });

    const app = createServer(config);

    const server = app.listen(config.port, () => {
      // Write PID file so --stop can find us (both foreground and background)
      writeFileSync(PID_FILE, String(process.pid) + "\n");

      const mapEntries = Object.entries(config.modelMap);
      const effectiveLevel = config.logLevel ?? (config.verbose ? "debug" : "info");

      const c = {
        reset:  "\x1b[0m",
        dim:    "\x1b[2m",
        yellow: "\x1b[33m",
        bGreen: "\x1b[1;32m",
        bCyan:  "\x1b[1;36m",
        bBlue:  "\x1b[1;34m",
        bWhite: "\x1b[1;37m",
      };

      // ── Layout constants ──
      const L = 40;  // left column inner width
      const R = 42;  // right column inner width
      const title = ` claude-code-ollama-proxy v${VERSION} `;

      // ── Build left column lines ──
      // Key on one line, value indented on the next line.
      const kv = (key: string, val: string) => [
        `${c.dim}${key}${c.reset}`,
        `  ${val}`,
      ];

      const leftLines: string[] = [];
      leftLines.push("");
      leftLines.push(`${c.bGreen}▶ http://localhost:${config.port}${c.reset}`);
      leftLines.push("");
      leftLines.push(...kv("Ollama", config.ollamaUrl));
      leftLines.push(...kv("Default model", `${c.bWhite}${config.defaultModel}${c.reset}`));
      leftLines.push(...kv("Log level", effectiveLevel));
      leftLines.push(...kv("Sequential tools", config.sequentialToolCalls ? "on" : "off"));
      if (config.logFile) {
        leftLines.push(...kv("Log file", config.logFile));
      }
      if (configFilePath) {
        leftLines.push(...kv("Config file", configFilePath));
      }
      if (mapEntries.length > 0) {
        leftLines.push("");
        for (const [k, v] of mapEntries) {
          leftLines.push(`${c.dim}${k}${c.reset} ${c.yellow}→${c.reset} ${v}`);
        }
      }

      // ── Build right column lines ──
      const rightLines: string[] = [];
      rightLines.push(`${c.bCyan}Quick start${c.reset}`);
      rightLines.push(`${c.bBlue}ANTHROPIC_BASE_URL=http://localhost:${config.port}${c.reset}`);
      rightLines.push(`${c.bBlue}ANTHROPIC_MODEL=${config.defaultModel}${c.reset}`);
      rightLines.push(`${c.bBlue}claude${c.reset}`);
      rightLines.push(`${c.dim}${"─".repeat(R)}${c.reset}`);
      if (config.strictThinking) {
        rightLines.push(`${c.bCyan}Thinking${c.reset}  ${c.yellow}strict${c.reset} ${c.dim}(400 on non-capable)${c.reset}`);
      } else {
        rightLines.push(`${c.bCyan}Thinking${c.reset}  ${c.dim}silently stripped${c.reset}`);
      }
      rightLines.push(`${c.dim}Capable: qwen3 deepseek-r1 magistral${c.reset}`);
      rightLines.push(`${c.dim}         nemotron glm4 qwq${c.reset}`);
      rightLines.push(`${c.dim}${"─".repeat(R)}${c.reset}`);
      rightLines.push(`${c.bCyan}Tips${c.reset}`);
      if (config.logFile && config.quiet) {
        rightLines.push(`${c.dim}Logs → ${config.logFile} only${c.reset}`);
      } else if (config.logFile) {
        rightLines.push(`${c.dim}Logs → stdout + ${config.logFile}${c.reset}`);
      } else {
        rightLines.push(`${c.dim}Add${c.reset} ${c.bBlue}--log-file proxy.log${c.reset} ${c.dim}for file logging${c.reset}`);
      }
      if (!configFilePath) {
        rightLines.push(`${c.dim}Run${c.reset} ${c.bBlue}--init${c.reset} ${c.dim}to generate config${c.reset}`);
      }
      rightLines.push(`${c.dim}Docs:${c.reset} ${c.bBlue}github.com/HerzCloudAI/…${c.reset}`);

      // ── Equalise row count ──
      const rows = Math.max(leftLines.length, rightLines.length);
      while (leftLines.length < rows) leftLines.push("");
      while (rightLines.length < rows) rightLines.push("");

      // ── Render ──
      // ANSI-aware visible length (strip escape sequences)
      const vis = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

      const innerW = L + R + 4; // " {L} │ {R}" between outer │s
      const topBorder = `╭───${title}${"─".repeat(innerW - 3 - title.length)}╮`;
      const botBorder = `╰${"─".repeat(innerW)}╯`;

      const output: string[] = ["", topBorder];
      for (let i = 0; i < rows; i++) {
        const lText = leftLines[i];
        const rText = rightLines[i];
        const lVis = vis(lText);
        const rPad = " ".repeat(Math.max(0, R - vis(rText)));

        let lCell: string;
        if (i === 1) {
          // Center the server URL line
          const gap = Math.max(0, L - lVis);
          const padLeft = Math.floor(gap / 2);
          lCell = " ".repeat(padLeft) + lText + " ".repeat(gap - padLeft);
        } else {
          lCell = lText + " ".repeat(Math.max(0, L - lVis));
        }

        output.push(`│ ${lCell} │ ${rText}${rPad}│`);
      }
      output.push(botBorder);
      output.push("");

      console.log(output.join("\n"));
    });

    function shutdown(signal: string) {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      try { unlinkSync(PID_FILE); } catch { /* already gone */ }
      server.close(() => {
        console.log("Server closed.");
        process.exit(0);
      });
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  });

program.parse();
