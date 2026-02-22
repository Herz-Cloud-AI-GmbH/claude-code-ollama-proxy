import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger, createLogger, parseLogLevel, generateRequestId } from "../src/logger.js";
import type { OtelLogRecord } from "../src/logger.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function captureStdout(): { records: OtelLogRecord[]; restore: () => void } {
  const records: OtelLogRecord[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    const line = typeof chunk === "string" ? chunk : String(chunk);
    for (const part of line.split("\n").filter(Boolean)) {
      try {
        records.push(JSON.parse(part) as OtelLogRecord);
      } catch {
        // not JSON — ignore
      }
    }
    return true;
  });
  return { records, restore: () => spy.mockRestore() };
}

// ─── OTEL Record Structure ────────────────────────────────────────────────────

describe("Logger — OTEL record structure", () => {
  let ctx: ReturnType<typeof captureStdout>;
  beforeEach(() => { ctx = captureStdout(); });
  afterEach(() => ctx.restore());

  it("emits valid OTEL JSON for info()", () => {
    const logger = createLogger({ level: "info", serviceName: "test-svc", serviceVersion: "1.2.3" });
    logger.info("Test message", { key: "value" });
    expect(ctx.records).toHaveLength(1);
    const r = ctx.records[0];
    expect(r.Body).toBe("Test message");
    expect(r.SeverityText).toBe("INFO");
    expect(r.SeverityNumber).toBe(9);
    expect(r.Attributes).toEqual({ key: "value" });
    expect(r.Resource["service.name"]).toBe("test-svc");
    expect(r.Resource["service.version"]).toBe("1.2.3");
  });

  it("Timestamp is a parseable ISO date string", () => {
    const logger = createLogger({ level: "info", serviceName: "s", serviceVersion: "0" });
    const before = Date.now();
    logger.info("ts");
    const after = Date.now();
    const ts = Date.parse(ctx.records[0].Timestamp);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("emits SeverityNumber=13 / SeverityText=WARN for warn()", () => {
    const logger = createLogger({ level: "warn", serviceName: "s", serviceVersion: "0" });
    logger.warn("w");
    expect(ctx.records[0].SeverityNumber).toBe(13);
    expect(ctx.records[0].SeverityText).toBe("WARN");
  });

  it("emits SeverityNumber=17 / SeverityText=ERROR for error()", () => {
    const logger = createLogger({ level: "error", serviceName: "s", serviceVersion: "0" });
    logger.error("e");
    expect(ctx.records[0].SeverityNumber).toBe(17);
    expect(ctx.records[0].SeverityText).toBe("ERROR");
  });

  it("emits SeverityNumber=5 / SeverityText=DEBUG for debug()", () => {
    const logger = createLogger({ level: "debug", serviceName: "s", serviceVersion: "0" });
    logger.debug("d");
    expect(ctx.records[0].SeverityNumber).toBe(5);
    expect(ctx.records[0].SeverityText).toBe("DEBUG");
  });

  it("emits empty Attributes object when none provided", () => {
    const logger = createLogger({ level: "info", serviceName: "s", serviceVersion: "0" });
    logger.info("no attrs");
    expect(ctx.records[0].Attributes).toEqual({});
  });

  it("includes nested attribute values in Attributes", () => {
    const logger = createLogger({ level: "info", serviceName: "s", serviceVersion: "0" });
    logger.info("body", { num: 42, nested: { x: true } });
    expect(ctx.records[0].Attributes.num).toBe(42);
    expect(ctx.records[0].Attributes.nested).toEqual({ x: true });
  });
});

// ─── Level Filtering ─────────────────────────────────────────────────────────

describe("Logger — level filtering", () => {
  let ctx: ReturnType<typeof captureStdout>;
  beforeEach(() => { ctx = captureStdout(); });
  afterEach(() => ctx.restore());

  it("INFO logger: debug() is suppressed", () => {
    createLogger({ level: "info", serviceName: "s", serviceVersion: "0" }).debug("d");
    expect(ctx.records).toHaveLength(0);
  });

  it("INFO logger: info() is emitted", () => {
    createLogger({ level: "info", serviceName: "s", serviceVersion: "0" }).info("i");
    expect(ctx.records).toHaveLength(1);
  });

  it("INFO logger: warn() is emitted", () => {
    createLogger({ level: "info", serviceName: "s", serviceVersion: "0" }).warn("w");
    expect(ctx.records).toHaveLength(1);
  });

  it("INFO logger: error() is emitted", () => {
    createLogger({ level: "info", serviceName: "s", serviceVersion: "0" }).error("e");
    expect(ctx.records).toHaveLength(1);
  });

  it("WARN logger: debug() is suppressed", () => {
    createLogger({ level: "warn", serviceName: "s", serviceVersion: "0" }).debug("d");
    expect(ctx.records).toHaveLength(0);
  });

  it("WARN logger: info() is suppressed", () => {
    createLogger({ level: "warn", serviceName: "s", serviceVersion: "0" }).info("i");
    expect(ctx.records).toHaveLength(0);
  });

  it("WARN logger: warn() is emitted", () => {
    createLogger({ level: "warn", serviceName: "s", serviceVersion: "0" }).warn("w");
    expect(ctx.records).toHaveLength(1);
  });

  it("WARN logger: error() is emitted", () => {
    createLogger({ level: "warn", serviceName: "s", serviceVersion: "0" }).error("e");
    expect(ctx.records).toHaveLength(1);
  });

  it("ERROR logger: debug() is suppressed", () => {
    createLogger({ level: "error", serviceName: "s", serviceVersion: "0" }).debug("d");
    expect(ctx.records).toHaveLength(0);
  });

  it("ERROR logger: info() is suppressed", () => {
    createLogger({ level: "error", serviceName: "s", serviceVersion: "0" }).info("i");
    expect(ctx.records).toHaveLength(0);
  });

  it("ERROR logger: warn() is suppressed", () => {
    createLogger({ level: "error", serviceName: "s", serviceVersion: "0" }).warn("w");
    expect(ctx.records).toHaveLength(0);
  });

  it("ERROR logger: error() is emitted", () => {
    createLogger({ level: "error", serviceName: "s", serviceVersion: "0" }).error("e");
    expect(ctx.records).toHaveLength(1);
  });

  it("DEBUG logger emits all four levels", () => {
    const logger = createLogger({ level: "debug", serviceName: "s", serviceVersion: "0" });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(ctx.records).toHaveLength(4);
  });

  it("DEBUG logger: debug() is emitted", () => {
    createLogger({ level: "debug", serviceName: "s", serviceVersion: "0" }).debug("d");
    expect(ctx.records).toHaveLength(1);
  });
});

// ─── Logger.level getter ──────────────────────────────────────────────────────

describe("Logger.level", () => {
  it("returns the configured level", () => {
    const logger = createLogger({ level: "warn", serviceName: "s", serviceVersion: "0" });
    expect(logger.level).toBe("warn");
  });
});

// ─── parseLogLevel ────────────────────────────────────────────────────────────

describe("parseLogLevel", () => {
  it("accepts 'error'", () => expect(parseLogLevel("error")).toBe("error"));
  it("accepts 'warn'",  () => expect(parseLogLevel("warn")).toBe("warn"));
  it("accepts 'info'",  () => expect(parseLogLevel("info")).toBe("info"));
  it("accepts 'debug'", () => expect(parseLogLevel("debug")).toBe("debug"));

  it("is case-insensitive — 'INFO' → 'info'", () => {
    expect(parseLogLevel("INFO")).toBe("info");
  });

  it("is case-insensitive — 'DEBUG' → 'debug'", () => {
    expect(parseLogLevel("DEBUG")).toBe("debug");
  });

  it("throws on empty string", () => {
    expect(() => parseLogLevel("")).toThrow("Invalid log level");
  });

  it("throws on unknown value 'trace'", () => {
    expect(() => parseLogLevel("trace")).toThrow("Invalid log level");
  });

  it("throws on unknown value 'verbose'", () => {
    expect(() => parseLogLevel("verbose")).toThrow("Invalid log level");
  });

  it("error message lists valid levels", () => {
    expect(() => parseLogLevel("bad")).toThrow(/error, warn, info, debug/);
  });
});

// ─── generateRequestId ────────────────────────────────────────────────────────

describe("generateRequestId", () => {
  it("returns string starting with 'req_'", () => {
    expect(generateRequestId()).toMatch(/^req_/);
  });

  it("the id portion is exactly 8 hex characters", () => {
    const id = generateRequestId();
    const hex = id.replace("req_", "");
    expect(hex).toHaveLength(8);
    expect(hex).toMatch(/^[0-9a-f]{8}$/);
  });

  it("returns unique values on consecutive calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateRequestId()));
    expect(ids.size).toBe(20);
  });
});

// ─── Logger instance used as Logger type ─────────────────────────────────────

describe("Logger class", () => {
  it("createLogger returns a Logger instance", () => {
    const logger = createLogger({ level: "info", serviceName: "s", serviceVersion: "0" });
    expect(logger).toBeInstanceOf(Logger);
  });
});
