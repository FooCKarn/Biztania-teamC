"""The same answer-key tests as test_pipeline.py, with fields read through the LLM path
(fake model, offline): the 7 planted conflicts must still be found and nothing else."""
import pytest

from auditconcierge.build import build
from auditconcierge.extract_llm import LLMExtractor
from fake_llm import FakeGemini
from test_pipeline import *  # noqa: F401,F403 — re-run every answer-key test on this module's fixture
from test_pipeline import SAMPLE


@pytest.fixture(scope="module")
def result():
    return build(SAMPLE, llm=LLMExtractor("test-key", "gemini-a", post=FakeGemini()))


def test_text_documents_were_read_by_the_llm(result):
    assert result["extraction"]["mode"] == "llm"
    assert result["extraction"]["template_fallback"] == []
    methods = {f["method"] for d in result["documents"] if d["format"] in ("pdf", "scan") for f in d["fields"].values()}
    assert methods == {"llm", "ocr"}
