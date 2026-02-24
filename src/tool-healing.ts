import { randomBytes } from "node:crypto";
import type { ToolSchemaInfo } from "./types.js";

/**
 * Generate a unique tool-use ID in the format `toolu_<16 random hex chars>`.
 */
export function generateToolUseId(): string {
  return `toolu_${randomBytes(8).toString("hex")}`;
}

/**
 * Build a lookup map from tool name → schema info (property names + types).
 * Built once per request, only when tool calls are present.
 */
export function buildToolSchemaMap(
  tools: Array<{ name: string; input_schema: Record<string, unknown> }>,
): Map<string, ToolSchemaInfo> {
  const map = new Map<string, ToolSchemaInfo>();
  for (const tool of tools) {
    const props = tool.input_schema.properties as Record<string, Record<string, unknown>> | undefined;
    if (props) {
      const names = new Set(Object.keys(props));
      const types = new Map<string, string>();
      for (const [name, schema] of Object.entries(props)) {
        if (typeof schema.type === "string") {
          types.set(name, schema.type);
        }
      }
      map.set(tool.name, { names, types });
    }
  }
  return map;
}

/**
 * Heal tool call parameter names by matching against the tool's JSON schema.
 *
 * When a model uses a wrong parameter name (e.g. "file" instead of "file_path"),
 * this function attempts to fix it by finding a unique schema property that
 * contains the wrong key as a substring.
 *
 * Returns the original args object if all keys are valid (zero-copy happy path),
 * or a new object with corrected keys if healing was needed.
 * The second return value lists any renames performed (for logging).
 */
export function healToolParameterNames(
  args: Record<string, unknown>,
  schemaProps: Set<string>,
): { healed: Record<string, unknown>; renames: Array<[string, string]> } {
  const renames: Array<[string, string]> = [];

  for (const key of Object.keys(args)) {
    if (schemaProps.has(key)) continue;

    // Find schema properties that contain this key as a substring
    const candidates: string[] = [];
    for (const prop of schemaProps) {
      if (prop.includes(key) || key.includes(prop)) {
        candidates.push(prop);
      }
    }

    if (candidates.length === 1) {
      renames.push([key, candidates[0]]);
    }
  }

  if (renames.length === 0) {
    return { healed: args, renames };
  }

  const result: Record<string, unknown> = {};
  const renameMap = new Map(renames);
  for (const [key, value] of Object.entries(args)) {
    result[renameMap.get(key) ?? key] = value;
  }
  return { healed: result, renames };
}

/**
 * Coerce argument values to match the expected JSON Schema types.
 *
 * Common model mistakes:
 *  - array where string expected → join with ", "
 *  - string where number expected → parseFloat
 *  - number where string expected → String()
 *  - string where boolean expected → "true"/"false" → boolean
 *
 * Returns the original args if no coercions needed (zero-copy happy path).
 */
export function healToolParameterTypes(
  args: Record<string, unknown>,
  schemaTypes: Map<string, string>,
): { healed: Record<string, unknown>; coercions: Array<[string, string, string]> } {
  const coercions: Array<[string, string, string]> = []; // [param, fromType, toType]
  let result: Record<string, unknown> | undefined;

  for (const [key, value] of Object.entries(args)) {
    const expectedType = schemaTypes.get(key);
    if (!expectedType || value === null || value === undefined) continue;

    const actualType = Array.isArray(value) ? "array" : typeof value;
    if (actualType === expectedType) continue;

    const coerced = coerceValue(value, actualType, expectedType);
    if (coerced === undefined) continue;

    result ??= { ...args };
    result[key] = coerced;
    coercions.push([key, actualType, expectedType]);
  }

  return { healed: result ?? args, coercions };
}

function coerceValue(value: unknown, from: string, to: string): unknown {
  if (to === "string" && from === "array") return (value as unknown[]).join(", ");
  if (to === "string" && from === "number") return String(value);
  if (to === "number" && from === "string") {
    const n = parseFloat(value as string);
    return isNaN(n) ? undefined : n;
  }
  if (to === "boolean" && from === "string") {
    const s = (value as string).toLowerCase();
    return s === "true" ? true : s === "false" ? false : undefined;
  }
  return undefined;
}

/**
 * Heal tool call arguments that may arrive from Ollama models as escaped JSON strings
 * instead of plain objects. Common issues:
 *
 *  1. Args is already an object → return as-is
 *  2. Args is a valid JSON string → parse and return
 *  3. Args is a doubly-escaped JSON string (e.g., `{\\"key\\":\\"val\\"}`) → unescape then parse
 *  4. Unrecoverable → return `{ raw: <original> }`
 */
export function healToolArguments(args: unknown): Record<string, unknown> {
  // Case 1: already an object (ideal path)
  if (args !== null && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }

  // Cases 2-4: args is a string
  if (typeof args === "string") {
    // Case 2: direct JSON parse
    try {
      const parsed = JSON.parse(args) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to case 3
    }

    // Case 3: double-escaped — replace `\"` → `"` and try again
    // Models sometimes return args like: {\"command\":\"ls\"} (no outer quotes)
    // or doubly stringify: "{\\\"command\\\":\\\"ls\\\"}"
    try {
      // Replace \" with " (unescape one level)
      const unescaped = args.replace(/\\"/g, '"');
      const parsed = JSON.parse(unescaped) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to case 4
    }

    // Case 3b: strip outer quotes if the string looks like a double-stringified JSON
    try {
      if (args.startsWith('"') && args.endsWith('"')) {
        const inner = JSON.parse(args) as unknown; // removes outer quotes
        if (typeof inner === "string") {
          const parsed = JSON.parse(inner) as unknown;
          if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        }
      }
    } catch {
      // fall through to case 4
    }
  }

  // Case 4: unrecoverable — wrap so callers always get an object
  return { raw: args };
}
