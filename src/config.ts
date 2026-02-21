import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ModelMap } from "./types.js";

/** Name of the auto-discovered config file searched for in the working directory. */
export const CONFIG_FILE_NAME = "proxy.config.json";

/**
 * Serialisable shape of the config file.
 * All fields are optional — missing entries fall back to CLI flag defaults.
 */
export type ProxyConfigFile = {
  /** Schema version — must be "1". */
  version: "1";
  /** TCP port the proxy listens on. */
  port?: number;
  /** Ollama base URL. */
  ollamaUrl?: string;
  /**
   * Ollama model used when the requested Claude model is not found in modelMap.
   *
   * AI-agent-first tip: set ANTHROPIC_MODEL=<your-ollama-model> when starting
   * Claude Code — the proxy passes non-Claude model names through directly,
   * making this field unnecessary.
   */
  defaultModel?: string;
  /**
   * Claude model name → Ollama model name.  Leave empty ({}) to route every
   * Claude model through defaultModel.
   *
   * Example for tier-based routing:
   *   "claude-opus-4-5":   "qwen3:32b"
   *   "claude-sonnet-4-5": "qwen3:8b"
   *   "claude-haiku-4-5":  "qwen3:1.7b"
   */
  modelMap?: ModelMap;
  /**
   * When false (default): thinking requests for non-thinking Ollama models are
   * silently stripped — the session continues without extended thinking.
   * When true: those requests are rejected with HTTP 400 instead.
   */
  strictThinking?: boolean;
  /** Log every request and response body to stdout. */
  verbose?: boolean;
};

/**
 * Load and parse a proxy config file from disk.
 * Returns null if the file does not exist.
 * Throws if the file exists but is not valid JSON.
 */
export function loadConfigFile(path: string): ProxyConfigFile | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ProxyConfigFile;
  } catch (err) {
    throw new Error(`Failed to parse config file "${path}": ${String(err)}`);
  }
}

/**
 * Write a well-documented default config file to `path`.
 * Existing values in `partial` are merged in (so callers can pre-fill fields
 * such as defaultModel from the current CLI flags).
 */
export function writeDefaultConfigFile(
  path: string,
  partial: Partial<ProxyConfigFile> = {},
): void {
  const cfg: ProxyConfigFile = {
    version: "1",
    port: 3000,
    ollamaUrl: "http://localhost:11434",
    defaultModel: "llama3.1",
    modelMap: {},
    strictThinking: false,
    verbose: false,
    ...partial,
  };
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

/**
 * Merge a config file's fields into a set of resolved option values.
 * CLI flags always take precedence over the config file.
 *
 * @param file   Parsed config file (may be null).
 * @param cli    Option values already resolved from CLI flags / env vars.
 * @returns      Merged options object.
 */
export function mergeConfig<
  T extends {
    port: number;
    ollamaUrl: string;
    defaultModel: string;
    modelMap: ModelMap;
    strictThinking: boolean;
    verbose: boolean;
  },
>(file: ProxyConfigFile | null, cli: T): T {
  if (!file) return cli;
  return {
    ...cli,
    // File values win unless an environment variable explicitly overrides.
    // (CLI option values cannot be distinguished from Commander defaults, so
    //  env vars are the reliable explicit-override signal for these fields.)
    port: file.port !== undefined && !process.env.PORT ? file.port : cli.port,
    ollamaUrl: file.ollamaUrl !== undefined && !process.env.OLLAMA_URL ? file.ollamaUrl : cli.ollamaUrl,
    defaultModel:
      file.defaultModel !== undefined && !process.env.DEFAULT_MODEL
        ? file.defaultModel
        : cli.defaultModel,
    // Model map: file is the base; CLI/repeated-flag entries overlay on top.
    modelMap:
      file.modelMap !== undefined ? { ...file.modelMap, ...cli.modelMap } : cli.modelMap,
    strictThinking:
      file.strictThinking !== undefined ? file.strictThinking : cli.strictThinking,
    verbose: file.verbose !== undefined ? file.verbose || cli.verbose : cli.verbose,
  };
}
