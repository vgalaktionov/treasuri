from __future__ import annotations

from app.sanitize import MAX_ERROR_MESSAGE_LENGTH, sanitize_error_message


def test_sanitize_error_message_redacts_key_value_secrets() -> None:
    message = "adapter failed soft_token=abc123 card_number=4111111111111111 password:sekret token=tok_123"

    sanitized = sanitize_error_message(message)

    assert "adapter failed" in sanitized
    assert "abc123" not in sanitized
    assert "4111111111111111" not in sanitized
    assert "sekret" not in sanitized
    assert "tok_123" not in sanitized
    assert sanitized.count("[redacted]") == 4


def test_sanitize_error_message_redacts_authorization_and_bearer_values() -> None:
    sanitized = sanitize_error_message("request failed Authorization: Bearer abc.def Bearer xyz")

    assert "abc.def" not in sanitized
    assert "xyz" not in sanitized
    assert "Authorization: [redacted]" in sanitized
    assert "Bearer [redacted]" in sanitized


def test_sanitize_error_message_redacts_url_credentials_and_query() -> None:
    sanitized = sanitize_error_message(
        RuntimeError("request failed http://user:pass@example.test:8080/path?access_token=abc#frag")
    )

    assert sanitized == "request failed http://[redacted]@example.test:8080/path"
    assert "user" not in sanitized
    assert "pass" not in sanitized
    assert "access_token" not in sanitized
    assert "abc" not in sanitized


def test_sanitize_error_message_uses_exception_type_for_empty_messages() -> None:
    assert sanitize_error_message(RuntimeError()) == "RuntimeError"
    assert sanitize_error_message("") == "Error"


def test_sanitize_error_message_truncates_after_redaction() -> None:
    sanitized = sanitize_error_message(f"failed token=secret {'x' * 600}")

    assert "secret" not in sanitized
    assert len(sanitized) == MAX_ERROR_MESSAGE_LENGTH
