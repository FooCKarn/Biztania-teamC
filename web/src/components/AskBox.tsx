import { useEffect, useRef, useState } from "react";
import { useSource } from "../source";
import { useAskFlag } from "../askContext";
import { locale, t } from "../i18n";

interface Msg {
  role: "user" | "assistant";
  content: string;
  cited?: string[];
  model?: string;
}
interface Convo {
  id: string;
  title: string;
  updated_at: string;
}

// Q&A goes through the Worker (/api/ask); the Gemini key never reaches the browser.
// Inside an engagement the conversation is saved per user and the server adds the earlier turns as
// context; on the public demo nothing is stored, so the page sends its own recent turns back.
export default function AskBox({ run }: { run?: string }) {
  const { engagement } = useSource();
  const flag = useAskFlag();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [conv, setConv] = useState<string | null>(null);
  const [history, setHistory] = useState<Convo[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const disabledForRealData = !!engagement && !engagement.synthetic;

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [msgs, busy, open, showHistory]);

  const send = async (question: string) => {
    question = question.trim();
    if (!question || busy) return;
    const before = msgs;
    setMsgs([...before, { role: "user", content: question }]);
    setQ("");
    setBusy(true);
    try {
      const r = await fetch("api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          ...(engagement
            ? { engagement: engagement.id, run, ...(conv && { conversation: conv }) }
            : { history: before.map(({ role, content }) => ({ role, content })) }),
        }),
      });
      const body = await r.json().catch(() => ({ answer: `${t("ตอบไม่ได้", "No answer")} (HTTP ${r.status})` }));
      if (body.conversation) setConv(body.conversation);
      setMsgs((m) => [...m, { role: "assistant", content: body.answer, cited: body.cited, model: body.model }]);
    } catch {
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: t("ติดต่อบริการถามตอบไม่ได้ (เปิดหน้าเว็บแบบ static อย่างเดียว)", "Q&A service unreachable (this page is served as static files only)") },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const newChat = () => {
    setMsgs([]);
    setConv(null);
    setShowHistory(false);
  };

  const openHistory = async () => {
    if (showHistory) return setShowHistory(false);
    setShowHistory(true);
    setHistory(null);
    try {
      const r = await fetch(`api/ask/conversations?engagement=${engagement!.id}`);
      setHistory(r.ok ? (await r.json()).conversations : []);
    } catch {
      setHistory([]);
    }
  };

  const load = async (id: string) => {
    const r = await fetch(`api/ask/conversations?engagement=${engagement!.id}&id=${id}`);
    if (!r.ok) return;
    const c = (await r.json()).conversation;
    setMsgs(
      c.messages.map((m: { role: "user" | "assistant"; content: string; cited: string | null; model: string | null }) => ({
        role: m.role,
        content: m.content,
        cited: m.cited ? JSON.parse(m.cited) : undefined,
        model: m.model ?? undefined,
      })),
    );
    setConv(id);
    setShowHistory(false);
  };

  const when = (iso: string) => new Date(iso).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="ask-fab-wrap">
      {open && (
        <aside className="ask-panel" aria-label={t("ถามระบบ", "Ask")}>
          <div className="ask-panel-head">
            <h3>{t("ถามจากผลการตรวจ", "Ask about these results")}</h3>
            <div className="ask-head-actions">
              {!disabledForRealData && (
                <button className="link" onClick={newChat} aria-label={t("เริ่มคุยใหม่", "New chat")} title={t("เริ่มคุยใหม่", "New chat")}>
                  ＋
                </button>
              )}
              {engagement && !disabledForRealData && (
                <button className="link" onClick={openHistory} aria-pressed={showHistory} aria-label={t("ประวัติการสนทนา", "History")} title={t("ประวัติการสนทนา", "History")}>
                  🕘
                </button>
              )}
              <button className="link" onClick={() => setOpen(false)} aria-label={t("ปิด", "Close")}>
                ✕
              </button>
            </div>
          </div>
          {disabledForRealData ? (
            <p className="muted small ask-pad">
              {t("ปิดการถาม AI สำหรับข้อมูลจริง จนกว่าจะเปลี่ยนผู้ให้บริการ AI ตามสัญญาข้อมูล", "AI Q&A is off for real data until the AI provider is switched under a data agreement.")}
            </p>
          ) : showHistory ? (
            <div className="ask-body">
              {history === null ? (
                <p className="muted small">{t("กำลังโหลด…", "Loading…")}</p>
              ) : history.length === 0 ? (
                <p className="muted small">{t("ยังไม่มีประวัติการสนทนา", "No saved conversations yet")}</p>
              ) : (
                <ul className="ask-history">
                  {history.map((c) => (
                    <li key={c.id}>
                      <button className={c.id === conv ? "active" : ""} onClick={() => load(c.id)}>
                        <span>{c.title}</span>
                        <span className="muted small">{when(c.updated_at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              <div className="ask-body" aria-live="polite">
                {msgs.length === 0 && (
                  <p className="muted small">
                    {t("ถามเป็นภาษาธรรมดา เช่น รายการไหนจ่ายเงินเข้าบัญชีที่ไม่ใช่ของ vendor", "Ask in plain words, e.g. which payments went to an account that is not the vendor's?")}
                  </p>
                )}
                {msgs.map((m, i) => (
                  <div key={i} className={"ask-msg " + m.role}>
                    <p>{m.content}</p>
                    {m.cited && m.cited.length > 0 && (
                      <p className="muted small">
                        {t("อ้างอิง", "Cited")}: {m.cited.join(", ")}
                      </p>
                    )}
                    {m.model && (
                      <p className="muted small">
                        {t("ตอบโดย", "Answered by")} {m.model}
                      </p>
                    )}
                  </div>
                ))}
                {busy && <p className="muted small">{t("กำลังถาม…", "Asking…")}</p>}
                <div ref={end} />
              </div>
              {flag && flag.questions.length > 0 && (
                <div className="ask-chips" role="group" aria-label={t("คำถามที่ควรถามต่อ", "Follow-up questions")}>
                  <span className="muted small">
                    {t("คำถามที่ควรถามต่อ", "Follow-up questions")} · {flag.id}
                  </span>
                  {flag.questions.map((s) => (
                    <button key={s} className="chip" disabled={busy} onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <form
                className="ask-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  send(q);
                }}
              >
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("พิมพ์คำถาม…", "Type a question…")}
                  maxLength={300}
                  aria-label={t("คำถาม", "Question")}
                />
                <button className="btn" disabled={busy || !q.trim()}>
                  {t("ถาม", "Ask")}
                </button>
              </form>
              <p className="muted small ask-pad ask-note">
                {t("คำตอบสร้างจากผลในหน้านี้เท่านั้น และเป็นข้อเสนอให้ตรวจ ไม่ใช่ข้อสรุป", "Answers use only the results on this page and are suggestions to check, not conclusions.")}
              </p>
            </>
          )}
        </aside>
      )}
      {!open && (
        <button className="ask-fab" onClick={() => setOpen(true)} aria-expanded={false} aria-label={t("ถาม AI", "Ask AI")}>
          <span aria-hidden>💬</span>
          <span className="ask-fab-label">{t("ถาม AI", "Ask AI")}</span>
        </button>
      )}
    </div>
  );
}
