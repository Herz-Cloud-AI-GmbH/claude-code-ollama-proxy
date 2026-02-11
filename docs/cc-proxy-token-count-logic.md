# Token counting for cc-proxy (future work)

## Findings
- Claude Code calls `POST /v1/messages/count_tokens` to estimate token usage before sending a full request.
- In the Anthropic API, the count endpoint accepts the same payload as `/v1/messages` and returns token counts without generating output.
- The current proxy returns 404 for `/v1/messages/count_tokens`, which can hurt efficiency and planning.
- Accurate counting depends on the **actual model tokenizer**, not heuristics.
- The proxy already adapts Anthropic payloads to OpenAI-compatible messages for Ollama; the tokenizer must reflect the adapted payload.

## Requirements
- Implement `POST /v1/messages/count_tokens` with an Anthropic-compatible response shape.
- Use the same request adaptation logic as `/v1/messages` to avoid drift.
- Count **input tokens only**; output tokens are zero or omitted.
- Support tool schemas and system prompts (these affect token usage).
- Keep performance acceptable for frequent calls from Claude Code.
- Avoid logging sensitive payloads unless explicitly enabled in config.
- If the tokenizer cannot be resolved for a model, return a clear error and surface it in logs.

## Tokenizer integrations (by model family)
Use **model-specific tokenizers** for correctness.

### Qwen (e.g. `qwen3:*`)
- Prefer the official tokenizer from the Qwen ecosystem or a compatible `tokenizers` vocab.
- Avoid generic `tiktoken` unless a verified mapping is available for the exact model.

### Llama-family (e.g. `llama3:*`)
- Use `llama-cpp-python` or another GGUF-aware tokenizer that matches the model file.
- Ensure tokenizer config matches the exact GGUF model (tokenizer revisions differ).

### Gemma (e.g. `gemma3:*`)
- Use the Gemma SentencePiece tokenizer for accurate counts.

### Unknown or custom models
- Provide a config-driven tokenizer mapping in `cc-proxy.user.yaml`.
- Fail fast with a clear message if tokenizer is not configured.

## Proposed implementation outline
1. Add `POST /v1/messages/count_tokens` endpoint.
2. Parse Anthropic payload with the existing models.
3. Reuse `to_openai_compat(...)` for a canonical message list.
4. Resolve model alias to the actual model ID.
5. Select tokenizer for the resolved model.
6. Count tokens from the adapted payload.
7. Return Anthropic-shaped response:
   - `input_tokens: <int>`
   - optionally `model: <requested>`

## Configuration ideas
- Add a `tokenizers` section to `cc-proxy.user.yaml`:
  - map model patterns to tokenizer implementations or vocab paths.
- Allow fallback behavior:
  - `strict` (error if missing) vs `best_effort` (approximate).


# Appendix: New Ideas

## Idea 1: Use characters as surrogate estimation

Estimate the tokens based on the following simple logic:
- for the incoming string count the total send characters
- divide them by 4
- use this result as estimation for tokens
[Reference:](https://www.edenai.co/post/understanding-llm-billing-from-characters-to-tokens)

## Idea 2: Use words and tokens as surrogate estimation

Estimate the tokens based on the following logic:
- split the incoming string into words based on whitespaces
- count each work that is not longer than 4 characters as 1 token
- for each work that is longer than 4 characters, count the length and get by modulo divison the number of tokens. E.g., word character length = 9.Then 9 % 4 = 3. I.e., the word is accounted with 3 tokens.


