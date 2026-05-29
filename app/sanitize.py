"""Sanitization helpers for errors that may be logged or rendered."""

from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit

MAX_ERROR_MESSAGE_LENGTH = 500

_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+")
_AUTHORIZATION_PATTERN = re.compile(r"(?i)\bAuthorization\s*:\s*(?:Bearer\s+)?[^\s,;&)]+")
_BEARER_PATTERN = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")
_KEY_VALUE_PATTERN = re.compile(
    r"(?i)\b(?P<key>access[_-]?token|refresh[_-]?token|id[_-]?token|soft[_-]?token|token|"
    r"secret|password|passwd|pwd|card(?:[_-]?number)?|iban)\b"
    r"(?P<separator>\s*[:=]\s*)[^\s,;&)]+"
)


def sanitize_error_message(error: Exception | str) -> str:
    fallback = type(error).__name__ if isinstance(error, Exception) else "Error"
    text = str(error)
    first_line = text.splitlines()[0].strip() if text else ""
    if not first_line:
        return fallback
    sanitized = _redact_urls(first_line)
    sanitized = _AUTHORIZATION_PATTERN.sub("Authorization: [redacted]", sanitized)
    sanitized = _BEARER_PATTERN.sub("Bearer [redacted]", sanitized)
    sanitized = _KEY_VALUE_PATTERN.sub(_redact_key_value, sanitized)
    return sanitized[:MAX_ERROR_MESSAGE_LENGTH] or fallback


def _redact_urls(value: str) -> str:
    return _URL_PATTERN.sub(_redact_url_match, value)


def _redact_url_match(match: re.Match[str]) -> str:
    candidate = match.group(0).rstrip(".,;)")
    trailing = match.group(0)[len(candidate) :]
    parsed = urlsplit(candidate)
    if not parsed.scheme or not parsed.netloc:
        return candidate + trailing
    hostname = parsed.hostname or ""
    if ":" in hostname and not hostname.startswith("["):
        hostname = f"[{hostname}]"
    try:
        port = f":{parsed.port}" if parsed.port is not None else ""
    except ValueError:
        port = ""
    userinfo = "[redacted]@" if parsed.username or parsed.password else ""
    return urlunsplit((parsed.scheme, f"{userinfo}{hostname}{port}", parsed.path, "", "")) + trailing


def _redact_key_value(match: re.Match[str]) -> str:
    return f"{match.group('key')}{match.group('separator')}[redacted]"
