from __future__ import annotations

from cc_proxy.app.models_anthropic import MessagesRequest, MessagesResponse


def test_messages_request_schema_has_core_fields() -> None:
    schema = MessagesRequest.model_json_schema()
    properties = schema.get("properties", {})
    assert "model" in properties
    assert "messages" in properties


def test_messages_response_schema_includes_content_blocks() -> None:
    schema = MessagesResponse.model_json_schema()
    content = schema.get("properties", {}).get("content", {})
    items = content.get("items", {})
    any_of = items.get("anyOf", [])
    serialized = str(any_of)
    assert "tool_use" in serialized
    assert "tool_result" in serialized
    assert "thinking" in serialized
    assert "redacted_thinking" in serialized
