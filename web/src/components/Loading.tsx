import { t } from "../i18n";

export default function Loading({ label }: { label?: string }) {
  return (
    <div className="empty loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      {label ?? t("กำลังโหลด…", "Loading…")}
    </div>
  );
}
