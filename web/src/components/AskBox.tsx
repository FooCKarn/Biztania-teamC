import { useState } from "react";
import { useSource } from "../source";

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
      const body = await r.json().catch(() => ({ answer: `ตอบไม่ได้ (HTTP ${r.status})` }));
      setRes(body);
    } catch {
      setRes({ answer: "ติดต่อบริการถามตอบไม่ได้ (เปิดหน้าเว็บแบบ static อย่างเดียว)" });
    } finally {
      setBusy(false);
    }
  };

  if (engagement && !engagement.synthetic)
    return (
      <section className="card ask" aria-label="ถามระบบ">
        <h3>ถามจากผลการตรวจ</h3>
        <p className="muted small">ปิดการถาม AI สำหรับข้อมูลจริง จนกว่าจะเปลี่ยนผู้ให้บริการ AI ตามสัญญาข้อมูล</p>
      </section>
    );
  return (
    <section className="card ask" aria-label="ถามระบบ">
      <h3>ถามจากผลการตรวจ</h3>
      <form onSubmit={ask} className="row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="เช่น รายการไหนจ่ายเงินเข้าบัญชีที่ไม่ใช่ของ vendor"
          maxLength={300}
          aria-label="คำถาม"
        />
        <button className="btn" disabled={busy || !q.trim()}>
          {busy ? "กำลังถาม…" : "ถาม"}
        </button>
      </form>
      {res && (
        <div className="answer">
          <p>{res.answer}</p>
          {res.cited && res.cited.length > 0 && <p className="muted small">อ้างอิง: {res.cited.join(", ")}</p>}
          {res.model && <p className="muted small">ตอบโดย {res.model}</p>}
        </div>
      )}
      <p className="muted small">คำตอบสร้างจากผลในหน้านี้เท่านั้น และเป็นข้อเสนอให้ตรวจ ไม่ใช่ข้อสรุป</p>
    </section>
  );
}
