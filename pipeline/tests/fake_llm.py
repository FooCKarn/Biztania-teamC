"""A stand-in for Gemini that answers the way a good model should: it points at the line and
copies the characters, using the template regexes. Lets the LLM path run offline in tests."""
import json
import re

from auditconcierge.extract_llm import KINDS
from auditconcierge.normalize import squash
from auditconcierge.readers import PRICE_LINE

POLICY_NO = r"เลขที่\s*(\S+)"


def _lines(prompt):
    doc = prompt.split("DOCUMENT:\n", 1)[1]
    return [(int(n), t) for n, t in (l.split("| ", 1) for l in doc.splitlines())]


def answer(prompt):
    lines = _lines(prompt)
    flat = squash(" ".join(t for _, t in lines))
    title = lines[0][1] if lines else ""
    if "สัญญา" in title:
        kind = "contract"
    elif sum(k in flat for k in ("ใบกำกับภาษี", "ใบแจ้งหนี้", "ยอดรวมทั้งสิ้น", "ภาษีมูลค่าเพิ่ม")) >= 2:
        kind = "invoice"
    elif "นโยบาย" in title:
        kind = "policy"
    else:
        return {"kind": "other", "fields": {}}
    fields = {}
    for name, (pat, _) in KINDS[kind].items():
        rx = re.compile(pat or POLICY_NO)
        fields[name] = next(({"line": n, "raw": m.group(1).strip(), "quote": m.group(0)}
                             for n, t in lines if (m := rx.search(t))), None)
    prices = [{"item": m.group(1).strip(), "line": n, "raw": m.group(2), "quote": m.group(0)}
              for n, t in lines if (m := PRICE_LINE.match(t))]
    return {"kind": kind, "fields": fields, "price_list": prices}


class FakeGemini:
    """post(url, headers, body, timeout) like extract_llm._http_post. statuses: model → HTTP status."""

    def __init__(self, reply=answer, statuses=None):
        self.reply, self.statuses, self.calls = reply, statuses or {}, []

    def __call__(self, url, headers, body, timeout):
        model = url.split("/models/")[1].split(":")[0]
        prompt = body["contents"][0]["parts"][0]["text"]
        self.calls.append((model, prompt))
        status = self.statuses.get(model, 200)
        if status != 200:
            return status, None
        text = "```json\n" + json.dumps(self.reply(prompt), ensure_ascii=False) + "\n```"
        return 200, {"candidates": [{"content": {"parts": [{"text": "thinking...", "thought": True}, {"text": text}]}}]}
