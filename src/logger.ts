import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import type { LogLevel } from "./types.js";

// ─── OTEL Severity Numbers ────────────────────────────────────────────────────
// Reference: https://opentelemetry.io/docs/specs/otel/logs/data-model/

const SEVERITY_NUMBERS: Record<LogLevel, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
};

const SEVERITY_TEXTS: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

// ─── Types ────────────────────────────────────────────────────────────────────

/** OTEL LogRecord shape emitted as a single NDJSON line to stdout. */
export type OtelLogRecord = {
  Timestamp: string;
  SeverityNumber: number;
  SeverityText: string;
  Body: string;
  Attributes: Record<string, unknown>;
  Resource: Record<string, string>;
};

export type LoggerConfig = {
  level: LogLevel;
  serviceName: string;
  serviceVersion: string;
  /**
   * Optional path to a log file. When set the file is truncated on open
   * (flags: 'w') so every proxy restart starts with a clean log. Each
   * NDJSON record is written to both stdout and the file.
   */
  logFile?: string;
};

// ─── Logger ───────────────────────────────────────────────────────────────────

/**
 * Structured logger that emits OTEL-compatible JSON records to stdout.
 *
 * Records below the configured level are suppressed before any
 * serialisation work is done, so there is zero performance overhead at
 * runtime for suppressed levels.
 *
 * Output format (one JSON object per line / NDJSON):
 * ```json
 * {"Timestamp":"…","SeverityNumber":9,"SeverityText":"INFO","Body":"…","Attributes":{…},"Resource":{…}}
 * ```
 * The otelcol `filelog` receiver or any OTLP-compatible collector can
 * consume this stream directly.
 */
export class Logger {
  private readonly levelNum: number;
  private readonly resource: Record<string, string>;
  private readonly fileStream?: WriteStream;

  constructor(private readonly config: LoggerConfig) {
    this.levelNum = SEVERITY_NUMBERS[config.level];
    this.resource = {
      "service.name": config.serviceName,
      "service.version": config.serviceVersion,
    };
    if (config.logFile) {
      this.fileStream = createWriteStream(config.logFile, { flags: "w" });
      this.fileStream.on("error", (err) => {
        process.stderr.write(`[logger] log file write error: ${err.message}\n`);
      });
    }
  }

  get level(): LogLevel {
    return this.config.level;
  }

  private shouldLog(level: LogLevel): boolean {
    return SEVERITY_NUMBERS[level] >= this.levelNum;
  }

  private emit(level: LogLevel, body: string, attributes: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;
    const record: OtelLogRecord = {
      Timestamp: new Date().toISOString(),
      SeverityNumber: SEVERITY_NUMBERS[level],
      SeverityText: SEVERITY_TEXTS[level],
      Body: body,
      Attributes: attributes,
      Resource: this.resource,
    };
    const line = JSON.stringify(record) + "\n";
    process.stdout.write(line);
    this.fileStream?.write(line);
  }

  error(body: string, attributes: Record<string, unknown> = {}): void {
    this.emit("error", body, attributes);
  }

  warn(body: string, attributes: Record<string, unknown> = {}): void {
    this.emit("warn", body, attributes);
  }

  info(body: string, attributes: Record<string, unknown> = {}): void {
    this.emit("info", body, attributes);
  }

  debug(body: string, attributes: Record<string, unknown> = {}): void {
    this.emit("debug", body, attributes);
  }
}

// ─── Factory + Utilities ──────────────────────────────────────────────────────

/** Create a Logger instance with the given configuration. */
export function createLogger(config: LoggerConfig): Logger {
  return new Logger(config);
}

/**
 * Parse a log level string (case-insensitive) into a `LogLevel`.
 * Throws an informative error for invalid values.
 */
export function parseLogLevel(value: string): LogLevel {
  const normalized = value.toLowerCase();
  if (
    normalized === "error" ||
    normalized === "warn" ||
    normalized === "info" ||
    normalized === "debug"
  ) {
    return normalized;
  }
  throw new Error(
    `Invalid log level "${value}". Must be one of: error, warn, info, debug`,
  );
}

/** Generate a short request-scoped correlation ID: `req_<8 hex chars>`. */
export function generateRequestId(): string {
  return `req_${randomBytes(4).toString("hex")}`;
}
