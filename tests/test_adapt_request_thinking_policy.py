from __future__ import annotations

from cc_proxy.app.adapt_request import apply_thinking_policy, to_anthropic_compat
from cc_proxy.app.models_anthropic import MessagesRequest


def _payload_with_thinking_blocks() -> dict:
    req = MessagesRequest.model_validate(
        {
            "model": "sonnet",
            "messages": [
                {
                    "role": "assistant",
                    "content": [
                        {"type": "thinking", "thinking": "step 1"},
                        {"type": "text", "text": "hello"},
                        {"type": "redacted_thinking", "data": "redacted"},
                    ],
                }
            ],
        }
    )
    return to_anthropic_compat(req, resolved_model="qwen3:14b")


def test_apply_thinking_policy_drops_blocks_when_not_capable() -> None:
    payload = _payload_with_thinking_blocks()
    adapted, result = apply_thinking_policy(payload, thinking_capable=False)

    content = adapted["messages"][0]["content"]
    assert [block.get("type") for block in content] == ["text"]
    assert result.thinking_blocks == 1
    assert result.redacted_blocks == 1
    assert result.dropped_blocks == 2
    assert result.warning_needed is True


def test_apply_thinking_policy_passes_blocks_when_capable() -> None:
    payload = _payload_with_thinking_blocks()
    adapted, result = apply_thinking_policy(payload, thinking_capable=True)

    content = adapted["messages"][0]["content"]
    assert [block.get("type") for block in content] == ["thinking", "text", "redacted_thinking"]
    assert result.dropped_blocks == 0
    assert result.warning_needed is False
