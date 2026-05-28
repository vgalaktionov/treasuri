"""OpenAI-compatible LLM fallback classifier."""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

from app.classify.pipeline import TransactionForClassification

PROMPT_VERSION = "classification-v1"
JsonObject = dict[str, Any]
JsonTransport = Callable[[str, JsonObject, int], JsonObject]


class LlmClassificationError(RuntimeError):
    """Raised when the LLM response cannot be trusted."""


@dataclass(frozen=True)
class LlmClassificationSuggestion:
    category: str
    merchant: str | None
    confidence: Decimal
    reason: str
    model_ref: str
    prompt_version: str = PROMPT_VERSION


class OpenAiCompatibleClassifier:
    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        timeout_seconds: int,
        temperature: float,
        transport: JsonTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.temperature = temperature
        self.transport = transport or _post_json

    def classify(
        self,
        transaction: TransactionForClassification,
        *,
        categories: Sequence[str],
    ) -> LlmClassificationSuggestion | None:
        allowed_categories = [category for category in categories if category != "Unknown"]
        if not allowed_categories:
            return None

        response = self.transport(
            f"{self.base_url}/chat/completions",
            _build_request_payload(transaction, allowed_categories, self.model, self.temperature),
            self.timeout_seconds,
        )
        content = _extract_message_content(response)
        suggestion = _parse_suggestion(content, allowed_categories)
        return LlmClassificationSuggestion(
            category=suggestion["category"],
            merchant=suggestion["merchant"],
            confidence=suggestion["confidence"],
            reason=suggestion["reason"],
            model_ref=self.model,
        )


def _build_request_payload(
    transaction: TransactionForClassification,
    categories: Sequence[str],
    model: str,
    temperature: float,
) -> JsonObject:
    return {
        "model": model,
        "temperature": temperature,
        "stream": False,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Classify one personal-finance transaction. Return only strict JSON with keys "
                    "category, merchant, confidence, and reason. Choose category only from allowed_categories."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "allowed_categories": list(categories),
                        "transaction": {
                            "amount": str(transaction.amount),
                            "description": transaction.description,
                            "counterparty_name": transaction.counterparty_name,
                            "counterparty_iban": transaction.counterparty_iban,
                            "merchant_name": transaction.merchant_name,
                        },
                    },
                    sort_keys=True,
                ),
            },
        ],
    }


def _post_json(url: str, payload: JsonObject, timeout_seconds: int) -> JsonObject:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            parsed = json.loads(response.read().decode("utf-8"))
    except (OSError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise LlmClassificationError("LLM classification request failed") from exc

    if not isinstance(parsed, dict):
        raise LlmClassificationError("LLM response must be a JSON object")
    return parsed


def _extract_message_content(response: JsonObject) -> str:
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices:
        raise LlmClassificationError("LLM response did not include choices")
    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        raise LlmClassificationError("LLM choice must be an object")
    message = first_choice.get("message")
    if not isinstance(message, dict):
        raise LlmClassificationError("LLM choice did not include a message")
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise LlmClassificationError("LLM message content must be a non-empty string")
    return content


def _parse_suggestion(content: str, allowed_categories: Sequence[str]) -> dict[str, Any]:
    try:
        raw_suggestion = json.loads(content)
    except json.JSONDecodeError as exc:
        raise LlmClassificationError("LLM message content must be strict JSON") from exc
    if not isinstance(raw_suggestion, dict):
        raise LlmClassificationError("LLM suggestion must be a JSON object")

    category = raw_suggestion.get("category")
    if not isinstance(category, str) or category not in allowed_categories:
        raise LlmClassificationError("LLM category must be one of the allowed categories")

    merchant = raw_suggestion.get("merchant")
    if merchant is not None and not isinstance(merchant, str):
        raise LlmClassificationError("LLM merchant must be a string or null")

    reason = raw_suggestion.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise LlmClassificationError("LLM reason must be a non-empty string")

    confidence = _read_confidence(raw_suggestion.get("confidence"))
    return {
        "category": category,
        "merchant": merchant.strip() if isinstance(merchant, str) and merchant.strip() else None,
        "confidence": confidence,
        "reason": reason.strip(),
    }


def _read_confidence(value: object) -> Decimal:
    try:
        confidence = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise LlmClassificationError("LLM confidence must be numeric") from exc
    if not Decimal("0") <= confidence <= Decimal("1"):
        raise LlmClassificationError("LLM confidence must be between 0 and 1")
    return confidence
