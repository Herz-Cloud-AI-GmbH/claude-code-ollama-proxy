import type { OllamaModelList, OllamaRequest, OllamaResponse } from "./types.js";

export class OllamaConnectionError extends Error {
  constructor(url: string, cause?: Error) {
    super(
      `Cannot connect to Ollama at ${url}. Is Ollama running? Original error: ${cause?.message ?? "unknown"}`,
    );
    this.name = "OllamaConnectionError";
  }
}

export class OllamaResponseError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Ollama returned ${status}: ${message}`);
    this.name = "OllamaResponseError";
  }
}

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Send a non-streaming chat request to Ollama.
 * Returns the parsed JSON response.
 */
export async function ollamaChat(
  baseUrl: string,
  request: OllamaRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<OllamaResponse> {
  const url = `${baseUrl}/api/chat`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, stream: false }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new OllamaConnectionError(baseUrl, err instanceof Error ? err : undefined);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OllamaResponseError(response.status, text);
  }

  return response.json() as Promise<OllamaResponse>;
}

/**
 * Send a streaming chat request to Ollama.
 * Returns the raw Response object so the caller can stream the body.
 */
export async function ollamaChatStream(
  baseUrl: string,
  request: OllamaRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const url = `${baseUrl}/api/chat`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, stream: true }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new OllamaConnectionError(baseUrl, err instanceof Error ? err : undefined);
  }

  if (!response.ok) {
    clearTimeout(timer);
    const text = await response.text().catch(() => "");
    throw new OllamaResponseError(response.status, text);
  }

  // Clear timeout once headers are received; streaming may take a while
  clearTimeout(timer);
  return response;
}

/**
 * List models available in Ollama.
 */
export async function ollamaListModels(baseUrl: string): Promise<OllamaModelList> {
  const url = `${baseUrl}/api/tags`;
  let response: Response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch (err) {
    throw new OllamaConnectionError(baseUrl, err instanceof Error ? err : undefined);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OllamaResponseError(response.status, text);
  }

  return response.json() as Promise<OllamaModelList>;
}
