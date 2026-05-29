from __future__ import annotations

import os
from decimal import Decimal

import pytest

from app.classify.llm import LLM_RUNTIME, LlmClassificationError, OpenAiCompatibleClassifier
from app.classify.pipeline import TransactionForClassification

pytestmark = pytest.mark.skipif(
    os.environ.get("TREASURI_LLM_SMOKE") != "1",
    reason="set TREASURI_LLM_SMOKE=1 to hit the local llama runtime",
)


def test_local_llama_runtime_classifies_sample_transaction() -> None:
    categories = ["Groceries", "Transport", "Subscriptions"]
    classifier = OpenAiCompatibleClassifier(
        base_url=os.environ.get("LLM_BASE_URL", "http://127.0.0.1:8080/v1"),
        model=os.environ.get("LLM_MODEL", "unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL"),
        timeout_seconds=int(os.environ.get("LLM_TIMEOUT_SECONDS", "30")),
        temperature=0,
    )

    try:
        suggestion = classifier.classify(
            TransactionForClassification(
                id=1,
                account_id=1,
                amount=Decimal("-23.45"),
                description="Sample supermarket grocery payment",
                counterparty_name="Sample Supermarket",
            ),
            categories=categories,
        )
    except LlmClassificationError as exc:
        pytest.fail(f"local llama classifier smoke failed: {exc}")

    assert suggestion is not None
    assert suggestion.category in categories
    assert suggestion.model_ref == os.environ.get("LLM_MODEL", "unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL")
    assert suggestion.runtime == LLM_RUNTIME
