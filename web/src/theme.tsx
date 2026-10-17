import { useSyncExternalStore, type ReactElement } from "react";
import { t } from "./i18n";

// Two colour themes: soft pink (default) and reading mode (warm, low glare).
// The choice is kept in localStorage `ac-theme`; index.html applies it before first paint. Without a stored
// choice (or a retired value such as "dark") it falls back to pink.

export type Theme = "pink" | "reading";
const KEY = "ac-theme";
const THEMES: Theme[] = ["pink", "reading"];

function initial(): Theme {
  try {
    const v = localStorage.getItem(KEY) as Theme | null;
    if (v && THEMES.includes(v)) return v;
  } catch {
    /* storage blocked: fall through to the default */
  }
  return "pink";
}

let current: Theme = initial();
const subs = new Set<() => void>();
document.documentElement.dataset.theme = current;

export function setTheme(v: Theme) {
  if (v === current) return;
  current = v;
  document.documentElement.dataset.theme = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage blocked: the choice lasts for this page view */
  }
  subs.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

const ICONS: Record<Theme, ReactElement> = {
  pink: <path d="M12 21s-7-4.4-9.3-9A5.3 5.3 0 0 1 12 6.6 5.3 5.3 0 0 1 21.3 12C19 16.6 12 21 12 21z" />,
  reading: <path d="M3 5.5C5.5 4.5 9 4.5 12 6.5c3-2 6.5-2 9-1V19c-2.5-1-6-1-9 1-3-2-6.5-2-9-1z M12 6.5V20" />,
};

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, () => current);
  const label: Record<Theme, string> = {
    pink: t("ขาว-ชมพูอ่อน", "Soft pink"),
    reading: t("โหมดอ่านสบายตา", "Reading mode"),
  };
  return (
    <div className="segmented theme-toggle" role="radiogroup" aria-label={t("ธีมสี", "Colour theme")}>
      {THEMES.map((v) => (
        <button key={v} role="radio" aria-checked={theme === v} title={label[v]} aria-label={label[v]} onClick={() => setTheme(v)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
            {ICONS[v]}
          </svg>
        </button>
      ))}
    </div>
  );
}
