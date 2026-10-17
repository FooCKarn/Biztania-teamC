import { useState } from "react";
import { useSource } from "../source";
import { t } from "../i18n";

interface Answer {
  answer: string;
  cited?: string[];
  configured?: boolean;
  model?: string;
}

// Q&A goes through the Worker (/api/ask). The Gemini key lives only in the Worker;
// the browser never sees it. The Worker answers only from conflict_map.json.
export default function AskBox({ run }: { run?: string }) {
  const { engagement } = useSource();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Answer | null>(null);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch("api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q.trim(), ...(engagement && { engagement: engagement.id, run }) }),
      });
      const body = await r.json().catch(() => ({ answer: `${t("ตอบไม่ได้", "No answer")} (HTTP ${r.status})` }));
      setRes(body);
    } catch {
      setRes({ answer: t("ติดต่อบริการถามตอบไม่ได้ (เปิดหน้าเว็บแบบ static อย่างเดียว)", "Q&A service unreachable (this page is served as static files only)") });
    } finally {
      setBusy(false);
    }
  };

  if (engagement && !engagement.synthetic)
    return (
      <section className="card ask" aria-label={t("ถามระบบ", "Ask")}>
        <h3>{t("ถามจากผลการตรวจ", "Ask about these results")}</h3>
        <p className="muted small">
          {t("ปิดการถาม AI สำหรับข้อมูลจริง จนกว่าจะเปลี่ยนผู้ให้บริการ AI ตามสัญญาข้อมูล", "AI Q&A is off for real data until the AI provider is switched under a data agreement.")}
        </p>
      </section>
    );
  return (
    <section className="card ask" aria-label={t("ถามระบบ", "Ask")}>
      <h3>{t("ถามจากผลการตรวจ", "Ask about these results")}</h3>
      <form onSubmit={ask} className="row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("เช่น รายการไหนจ่ายเงินเข้าบัญชีที่ไม่ใช่ของ vendor", "e.g. Which payments went to an account that is not the vendor's?")}
          maxLength={300}
          aria-label={t("คำถาม", "Question")}
        />
        <button className="btn" disabled={busy || !q.trim()}>
          {busy ? t("กำลังถาม…", "Asking…") : t("ถาม", "Ask")}
        </button>
      </form>
      {res && (
        <div className="answer">
          <p>{res.answer}</p>
          {res.cited && res.cited.length > 0 && <p className="muted small">
              {t("อ้างอิง", "Cited")}: {res.cited.join(", ")}
            </p>}
          {res.model && <p className="muted small">
              {t("ตอบโดย", "Answered by")} {res.model}
            </p>}
        </div>
      )}
      <p className="muted small">
        {t("คำตอบสร้างจากผลในหน้านี้เท่านั้น และเป็นข้อเสนอให้ตรวจ ไม่ใช่ข้อสรุป", "Answers use only the results on this page and are suggestions to check, not conclusions.")}
      </p>
    </section>
  );
}
