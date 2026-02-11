from __future__ import annotations

from cc_proxy.app.adapt_request import prepare_anthropic_payload
from cc_proxy.app.models_anthropic import MessagesRequest
from cc_proxy.app.routing import load_routing_config


def test_use_tools_marker_injects_system_instruction() -> None:
    request = MessagesRequest.model_validate(
        {
            "model": "haiku",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Search for AWS Bedrock features (use_tools)",
                        }
                    ],
                }
            ],
            "tools": [
                {
                    "name": "get_latest_features",
                    "description": "Return latest features.",
                    "input_schema": {"type": "object", "properties": {}, "required": []},
                }
            ],
        }
    )

    adapted, _, _ = prepare_anthropic_payload(request, routing=load_routing_config())

    messages_text = str(adapted.get("messages"))
    assert "use_tools" not in messages_text.lower()
    assert adapted.get("temperature") == 0
    system_blocks = adapted.get("system") or []
    assert any(
        isinstance(block, dict)
        and block.get("type") == "text"
        and "must call a tool" in str(block.get("text") or "").lower()
        for block in system_blocks
    )
