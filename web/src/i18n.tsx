import { useSyncExternalStore } from "react";

// Two languages, Thai first. Strings stay next to the code that shows them as a pair: t("ไทย", "English").
// The choice is kept in this browser (localStorage) and the root re-renders on change, so plain t() calls
// during render always follow the current language.

export type Lang = "th" | "en";
const KEY = "ac-lang";

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "th" || v === "en") return v;
  } catch {
    /* storage blocked: default language */
  }
  return "th";
}

let current: Lang = initial();
const subs = new Set<() => void>();

function apply() {
  document.documentElement.lang = current;
  document.title = t("AuditPal · แผนที่เอกสารขัดแย้ง", "AuditPal · Document conflict map");
}

export const getLang = () => current;

export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* storage blocked: the choice lasts for this page view */
  }
  apply();
  subs.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

/** Re-render on language change. App calls it once at the root; components with memoised text call it too. */
export const useLang = () => useSyncExternalStore(subscribe, getLang);

/** The text for the current language. */
export const t = (th: string, en: string) => (current === "en" ? en : th);

/** A label table whose values follow the current language, read like a plain record: LABEL[key]. */
export function bi<K extends string>(pairs: Record<K, readonly [th: string, en: string]>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(pairs) as K[]) Object.defineProperty(out, k, { enumerable: true, get: () => t(pairs[k][0], pairs[k][1]) });
  return out;
}

/** Locale for numbers and dates. Thai keeps the Buddhist-era calendar the team reads. */
export const locale = () => (current === "en" ? "en-GB" : "th-TH");

export function LangToggle() {
  const lang = useLang();
  return (
    <div className="segmented lang-toggle" role="radiogroup" aria-label={t("ภาษา", "Language")}>
      {(
        [
          ["th", "ไทย"],
          ["en", "EN"],
        ] as const
      ).map(([l, label]) => (
        <button key={l} role="radio" aria-checked={lang === l} lang={l} onClick={() => setLang(l)}>
          {label}
        </button>
      ))}
    </div>
  );
}

apply();
