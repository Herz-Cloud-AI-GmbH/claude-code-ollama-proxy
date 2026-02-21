import { randomBytes } from "node:crypto";

/**
 * Generate a unique tool-use ID in the format `toolu_<16 random hex chars>`.
 */
export function generateToolUseId(): string {
  return `toolu_${randomBytes(8).toString("hex")}`;
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
