import { json } from "@/db";
import { Badge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { swapHook, doctorNow } from "@/app/actions";
import type { DoctorNote } from "@/lib/agents";

/** The Hook Doctor's verdict on one script: score, failed checks, three better hooks to swap in. */
export function HookDoctor({ s, canEdit, open }: { s: any; canEdit: boolean; open?: boolean }) {
  const d = json<DoctorNote | null>(s.doctor, null);
  if (!d) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span>Hook Doctor hasn&apos;t read this one yet.</span>
        {canEdit ? (
          <ActionForm action={doctorNow}>
            <input type="hidden" name="id" value={s.id} />
            <Submit className="btn-ghost">Ask now</Submit>
          </ActionForm>
        ) : null}
      </div>
    );
  }
  const tone = d.score >= 7 ? "green" : d.score >= 5 ? "amber" : "red";
  const failed = (Array.isArray(d.checks) ? d.checks : []).filter((c) => c && !c.ok);
  const hooks = Array.isArray(d.better_hooks) ? d.better_hooks : [];
  return (
    <details className="mt-3 rounded-lg border border-line" open={open}>
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs">
        <Badge tone={tone}>Hook {d.score}/10</Badge>
        <span className="text-muted">{failed.length ? `${failed.length} playbook check${failed.length > 1 ? "s" : ""} missed` : "passes the playbook"} · {hooks.length} better hooks</span>
      </summary>
      <div className="space-y-2 border-t border-line px-3 py-2 text-xs">
        {failed.length ? (
          <ul className="space-y-0.5">
            {failed.map((c, i) => (
              <li key={i} className="text-amber-800">✗ {c.check} — {c.note}</li>
            ))}
          </ul>
        ) : null}
        {d.fix ? <p><b>Biggest fix:</b> {d.fix}</p> : null}
        {hooks.map((h, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="flex-1 rounded bg-canvas px-2 py-1 text-[13px] text-ink">{h}</span>
            {canEdit ? (
              <ActionForm action={swapHook}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="hook" value={h} />
                <Submit className="btn-ghost">Use</Submit>
              </ActionForm>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}
