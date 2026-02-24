import { describe, expect, it } from "vitest";
import {
  generateToolUseId,
  healToolArguments,
  healToolParameterNames,
  healToolParameterTypes,
  buildToolSchemaMap,
} from "../src/tool-healing.js";

describe("generateToolUseId", () => {
  it("generates an ID matching the toolu_ prefix pattern", () => {
    const id = generateToolUseId();
    expect(id).toMatch(/^toolu_[0-9a-f]{16}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateToolUseId()));
    expect(ids.size).toBe(100);
  });
});

describe("healToolArguments", () => {
  it("returns an object as-is when already an object", () => {
    const input = { command: "ls", flag: "-la" };
    expect(healToolArguments(input)).toEqual(input);
  });

  it("parses a valid JSON string to an object", () => {
    const input = '{"command":"ls","flag":"-la"}';
    expect(healToolArguments(input)).toEqual({ command: "ls", flag: "-la" });
  });

  it("handles JSON string with nested object", () => {
    const input = '{"options":{"recursive":true},"path":"/tmp"}';
    expect(healToolArguments(input)).toEqual({
      options: { recursive: true },
      path: "/tmp",
    });
  });

  it("repairs double-escaped JSON string (backslash before quotes)", () => {
    // Simulate: model returned {\"command\":\"ls\"} (backslash-escaped quotes without outer quotes)
    const input = '{\\"command\\":\\"ls\\"}';
    const result = healToolArguments(input);
    expect(result).toEqual({ command: "ls" });
  });

  it("repairs double-stringified JSON (outer quotes wrapping JSON string)", () => {
    // Simulate: model returned "{\"command\":\"ls\"}" (string containing JSON)
    const inner = JSON.stringify({ command: "ls" }); // '{"command":"ls"}'
    const outer = JSON.stringify(inner); // '"{\\"command\\":\\"ls\\"}"'
    const result = healToolArguments(outer);
    expect(result).toEqual({ command: "ls" });
  });

  it("wraps unrecoverable input in {raw: ...}", () => {
    expect(healToolArguments("not-json")).toEqual({ raw: "not-json" });
  });

  it("wraps null in {raw: null}", () => {
    expect(healToolArguments(null)).toEqual({ raw: null });
  });

  it("wraps number in {raw: 42}", () => {
    expect(healToolArguments(42)).toEqual({ raw: 42 });
  });

  it("returns empty object unchanged", () => {
    expect(healToolArguments({})).toEqual({});
  });

  it("handles JSON string with unicode characters", () => {
    const input = '{"message":"héllo wörld"}';
    expect(healToolArguments(input)).toEqual({ message: "héllo wörld" });
  });

  it("handles JSON string with backslash paths (windows-style)", () => {
    const input = '{"path":"C:\\\\Users\\\\test"}';
    expect(healToolArguments(input)).toEqual({ path: "C:\\Users\\test" });
  });
});

describe("healToolParameterNames", () => {
  const readSchema = new Set(["file_path", "offset", "limit", "pages"]);

  it("returns args unchanged when all keys match the schema", () => {
    const args = { file_path: "/tmp/foo.txt", offset: 10 };
    const { healed, renames } = healToolParameterNames(args, readSchema);
    expect(healed).toBe(args); // same reference — zero-copy
    expect(renames).toEqual([]);
  });

  it("renames 'file' → 'file_path' (wrong key is substring of schema key)", () => {
    const args = { file: "/tmp/foo.txt" };
    const { healed, renames } = healToolParameterNames(args, readSchema);
    expect(healed).toEqual({ file_path: "/tmp/foo.txt" });
    expect(renames).toEqual([["file", "file_path"]]);
  });

  it("renames 'path' → 'file_path' (wrong key is substring of schema key)", () => {
    const args = { path: "/tmp/foo.txt" };
    const { healed, renames } = healToolParameterNames(args, readSchema);
    expect(healed).toEqual({ file_path: "/tmp/foo.txt" });
    expect(renames).toEqual([["path", "file_path"]]);
  });

  it("does not rename when wrong key matches multiple schema properties", () => {
    // "i" is a substring of both "file_path" and "limit"
    const args = { i: 5 };
    const { healed, renames } = healToolParameterNames(args, readSchema);
    expect(healed).toEqual({ i: 5 }); // unchanged — ambiguous
    expect(renames).toEqual([]);
  });

  it("does not rename when wrong key has no substring match", () => {
    const args = { unknown_param: "value" };
    const { healed, renames } = healToolParameterNames(args, readSchema);
    expect(healed).toEqual({ unknown_param: "value" });
    expect(renames).toEqual([]);
  });

  it("preserves correct keys alongside a renamed key", () => {
    const args = { file: "/tmp/foo.txt", offset: 10, limit: 50 };
    const { healed, renames } = healToolParameterNames(args, readSchema);
    expect(healed).toEqual({ file_path: "/tmp/foo.txt", offset: 10, limit: 50 });
    expect(renames).toEqual([["file", "file_path"]]);
  });

  it("handles empty args", () => {
    const { healed, renames } = healToolParameterNames({}, readSchema);
    expect(healed).toEqual({});
    expect(renames).toEqual([]);
  });

  it("renames when schema key contains the wrong key (reverse direction)", () => {
    const schema = new Set(["file_path"]);
    const args = { file: "/tmp/foo.txt" };
    const { healed, renames } = healToolParameterNames(args, schema);
    expect(healed).toEqual({ file_path: "/tmp/foo.txt" });
    expect(renames).toEqual([["file", "file_path"]]);
  });

  it("does not rename when keys share no contiguous substring", () => {
    const schema = new Set(["cmd"]);
    const args = { command: "ls" };
    const { healed, renames } = healToolParameterNames(args, schema);
    expect(healed).toEqual({ command: "ls" }); // no match — "cmd" not in "command"
    expect(renames).toEqual([]);
  });
});

describe("buildToolSchemaMap", () => {
  it("builds a map with names and types from tool definitions", () => {
    const tools = [
      {
        name: "Read",
        input_schema: {
          type: "object",
          properties: { file_path: { type: "string" }, offset: { type: "number" } },
        },
      },
      {
        name: "Write",
        input_schema: {
          type: "object",
          properties: { file_path: { type: "string" }, content: { type: "string" } },
        },
      },
    ];
    const map = buildToolSchemaMap(tools);
    expect(map.get("Read")?.names).toEqual(new Set(["file_path", "offset"]));
    expect(map.get("Read")?.types).toEqual(new Map([["file_path", "string"], ["offset", "number"]]));
    expect(map.get("Write")?.names).toEqual(new Set(["file_path", "content"]));
  });

  it("handles tools with no properties", () => {
    const tools = [{ name: "NoArgs", input_schema: { type: "object" } }];
    const map = buildToolSchemaMap(tools);
    expect(map.has("NoArgs")).toBe(false);
  });

  it("returns empty map for empty tools array", () => {
    const map = buildToolSchemaMap([]);
    expect(map.size).toBe(0);
  });

  it("skips properties without a type field", () => {
    const tools = [
      {
        name: "Mixed",
        input_schema: {
          type: "object",
          properties: {
            typed: { type: "string" },
            untyped: { description: "no type here" },
          },
        },
      },
    ];
    const map = buildToolSchemaMap(tools);
    expect(map.get("Mixed")?.names).toEqual(new Set(["typed", "untyped"]));
    expect(map.get("Mixed")?.types).toEqual(new Map([["typed", "string"]]));
  });
});

describe("healToolParameterTypes", () => {
  it("returns args unchanged when all types match", () => {
    const types = new Map([["pattern", "string"], ["limit", "number"]]);
    const args = { pattern: "*.ts", limit: 10 };
    const { healed, coercions } = healToolParameterTypes(args, types);
    expect(healed).toBe(args); // same reference — zero-copy
    expect(coercions).toEqual([]);
  });

  it("coerces array to string by joining with comma-space", () => {
    const types = new Map([["pattern", "string"]]);
    const args = { pattern: ["*.ts", "*.js", "docs/*.md"] };
    const { healed, coercions } = healToolParameterTypes(args, types);
    expect(healed).toEqual({ pattern: "*.ts, *.js, docs/*.md" });
    expect(coercions).toEqual([["pattern", "array", "string"]]);
  });

  it("coerces number to string", () => {
    const types = new Map([["port", "string"]]);
    const args = { port: 3000 };
    const { healed, coercions } = healToolParameterTypes(args, types);
    expect(healed).toEqual({ port: "3000" });
    expect(coercions).toEqual([["port", "number", "string"]]);
  });

  it("coerces string to number", () => {
    const types = new Map([["offset", "number"]]);
    const args = { offset: "42" };
    const { healed, coercions } = healToolParameterTypes(args, types);
    expect(healed).toEqual({ offset: 42 });
    expect(coercions).toEqual([["offset", "string", "number"]]);
  });

  it("does not coerce non-numeric string to number", () => {
    const types = new Map([["offset", "number"]]);
    const args = { offset: "abc" };
    const { healed, coercions } = healToolParameterTypes(args, types);
    expect(healed).toBe(args);
    expect(coercions).toEqual([]);
  });

  it("coerces string 'true'/'false' to boolean", () => {
    const types = new Map([["recursive", "boolean"]]);
    const args = { recursive: "true" };
    const { healed, coercions } = healToolParameterTypes(args, types);
    expect(healed).toEqual({ recursive: true });
    expect(coercions).toEqual([["recursive", "string", "boolean"]]);
  });

  it("coerces string 'FALSE' to boolean (case-insensitive)", () => {
    const types = new Map([["recursive", "boolean"]]);
    const args = { recursive: "FALSE" };
    const { healed, coercions } = healToolParameterTypes(args, types);
    expect(healed).toEqual({ recursive: false });
    expect(coercions).toEqual([["recursive", "string", "boolean"]]);
  });

  it("does not coerce non-boolean string to boolean", () => {
    const types = new Map([["recursive", "boolean"]]);
    const args = { recursive: "yes" };
    const { healed, coercions } = healToolParameterTypes(args, types);
    expect(healed).toBe(args);
    expect(coercions).toEqual([]);
  });

  it("preserves correct keys alongside coerced keys", () => {
    const types = new Map([["pattern", "string"], ["path", "string"]]);
    const args = { pattern: ["*.ts", "*.js"], path: "/workspaces" };
    const { healed, coercions } = healToolParameterTypes(args, types);
    expect(healed).toEqual({ pattern: "*.ts, *.js", path: "/workspaces" });
    expect(coercions).toEqual([["pattern", "array", "string"]]);
  });

  it("handles null and undefined values gracefully", () => {
    const types = new Map([["pattern", "string"]]);
    const args = { pattern: null };
    const { healed, coercions } = healToolParameterTypes(args, types);
    expect(healed).toBe(args);
    expect(coercions).toEqual([]);
  });

  it("skips keys not in schema types", () => {
    const types = new Map([["pattern", "string"]]);
    const args = { pattern: "*.ts", unknown: [1, 2, 3] };
    const { healed, coercions } = healToolParameterTypes(args, types);
    expect(healed).toBe(args);
    expect(coercions).toEqual([]);
  });

  it("handles the exact Glob failure case: patterns array → pattern string", () => {
    const types = new Map([["pattern", "string"], ["path", "string"]]);
    const args = { pattern: ["README.md", "HOWTO.md", "AGENTS.md", "docs/*.md"] };
    const { healed, coercions } = healToolParameterTypes(args, types);
    expect(healed).toEqual({ pattern: "README.md, HOWTO.md, AGENTS.md, docs/*.md" });
    expect(coercions).toEqual([["pattern", "array", "string"]]);
  });
});
