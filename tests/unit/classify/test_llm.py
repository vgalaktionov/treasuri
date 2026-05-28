from __future__ import annotations

import json
from decimal import Decimal

import pytest

from app.classify.llm import LlmClassificationError, OpenAiCompatibleClassifier
from app.classify.pipeline import TransactionForClassification


def transaction() -> TransactionForClassification:
    return TransactionForClassification(
        id=1,
        account_id=2,
        amount=Decimal("-12.30"),
        description="Sample Supermarket",
        counterparty_name="Sample BV",
    )


def test_openai_classifier_accepts_strict_json_suggestion() -> None:
    captured_payload: dict[str, object] = {}

    def transport(url: str, payload: dict[str, object], timeout_seconds: int) -> dict[str, object]:
        captured_payload.update(payload)
        assert url == "http://llama:8080/v1/chat/completions"
        assert timeout_seconds == 3
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "category": "Groceries",
                                "merchant": "Sample Supermarket",
                                "confidence": 0.72,
                                "reason": "The description names a supermarket.",
                            }
                        )
                    }
                }
            ]
        }

    classifier = OpenAiCompatibleClassifier(
        base_url="http://llama:8080/v1/",
        model="local-model",
        timeout_seconds=3,
        temperature=0,
        transport=transport,
    )

    suggestion = classifier.classify(transaction(), categories=["Groceries", "Rent", "Unknown"])

    assert suggestion is not None
    assert suggestion.category == "Groceries"
    assert suggestion.merchant == "Sample Supermarket"
    assert suggestion.confidence == Decimal("0.72")
    assert suggestion.model_ref == "local-model"
    assert captured_payload["model"] == "local-model"
    assert captured_payload["temperature"] == 0


def test_openai_classifier_rejects_unknown_category() -> None:
    classifier = OpenAiCompatibleClassifier(
        base_url="http://llama:8080/v1",
        model="local-model",
        timeout_seconds=3,
        temperature=0,
        transport=lambda _url, _payload, _timeout: {
            "choices": [{"message": {"content": '{"category":"Made Up","confidence":0.7,"reason":"bad"}'}}]
        },
    )

    with pytest.raises(LlmClassificationError, match="allowed categories"):
        classifier.classify(transaction(), categories=["Groceries", "Rent"])


def test_openai_classifier_rejects_non_json_content() -> None:
    classifier = OpenAiCompatibleClassifier(
        base_url="http://llama:8080/v1",
        model="local-model",
        timeout_seconds=3,
        temperature=0,
        transport=lambda _url, _payload, _timeout: {"choices": [{"message": {"content": "Category: Groceries"}}]},
    )

    with pytest.raises(LlmClassificationError, match="strict JSON"):
        classifier.classify(transaction(), categories=["Groceries", "Rent"])
