import Link from "next/link";
import { json } from "@/db";
import { Badge, Status, ago } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { decideScript } from "@/app/actions";
import { HookDoctor } from "@/components/HookDoctor";
import { stamp } from "@/lib/edit/longform";
import { MIX_LABEL, type Mix } from "@/lib/planner";
import { scriptSeen } from "@/lib/seen";

export function ComplianceNotes({ compliance }: { compliance: string }) {
  const c = json<{ status: string; issues: { level: string; match: string; fix: string }[] }>(compliance, { status: "ok", issues: [] });
  if (!c.issues.length) return null;
  return (
    <ul className="mt-3 space-y-1">
      {c.issues.map((i, k) => (
        <li key={k} className={`rounded-lg px-3 py-1.5 text-xs ${i.level === "block" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
          <b>{i.level === "block" ? "Must fix" : "Check"}:</b> “{i.match}” — {i.fix}
        </li>
      ))}
    </ul>
  );
}

export function ScriptCard({ s, canApprove, laneName }: { s: any; canApprove: boolean; laneName?: string }) {
  const onScreen = json<{ text: string }[]>(s.on_screen, []);
  const blocked = json<any>(s.compliance, {}).status === "block";
  return (
    <div className="card p-5">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <span className="font-medium text-ink">{s.speaker}</span>
        <span>·</span>
        <Badge tone="violet">{laneName || s.lane}</Badge>
        <Badge>{String(s.hook_type || "").replace(/_/g, " ")}</Badge>
        <Badge>{String(s.format || "").replace(/_/g, " ")}</Badge>
        {s.length_sec ? <Badge>~{s.length_sec}s</Badge> : null}
        {s.source === "clip" ? (
          <Link href={`/sessions/${s.session_id}`}><Badge tone="blue">clip · {stamp(s.clip_start)}–{stamp(s.clip_end)}</Badge></Link>
        ) : null}
        {s.mix && s.mix !== "core" ? <Badge>{MIX_LABEL[s.mix as Mix] || s.mix}</Badge> : null}
        <Status s={s.status} />
        <span className="ml-auto">{ago(s.created_at)}</span>
      </div>
      <h3 className="font-semibold">{s.title}</h3>
      {s.source === "clip" ? <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted">On screen for the first 3 seconds</p> : null}
      <p className={`${s.source === "clip" ? "mt-0.5" : "mt-2"} text-[15px] font-semibold leading-snug text-accent`}>{s.hook}</p>
      {s.source === "clip" ? <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted">What they say (from the recording)</p> : null}
      <p className={`${s.source === "clip" ? "mt-0.5 line-clamp-6" : "mt-2"} whitespace-pre-wrap text-sm leading-relaxed`}>{s.body}</p>
      {s.cta ? <p className="mt-2 text-sm italic">{s.cta}</p> : null}
      {onScreen.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {onScreen.map((o, i) => (
            <span key={i} className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-900">{o.text}</span>
          ))}
        </div>
      ) : null}
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer select-none">Caption, hashtags and why this one</summary>
        <p className="mt-2 whitespace-pre-wrap text-ink">{s.caption}</p>
        <p className="mt-1 text-accent">{s.hashtags}</p>
        {s.why ? <p className="mt-2"><b>Why:</b> {s.why}</p> : null}
        {s.ref_link ? (
          <p className="mt-1">
            <b>Inspired by:</b>{" "}
            <a className="link" href={s.ref_link} target="_blank" rel="noreferrer">{s.ref_name} ({Number(s.ref_outlier).toFixed(1)}× their usual)</a>
          </p>
        ) : null}
      </details>
      <ComplianceNotes compliance={s.compliance} />
      {s.notes ? <p className="mt-2 text-xs text-muted">{s.notes}</p> : null}
      {s.status === "proposed" || s.status === "approved" ? <HookDoctor s={s} canEdit={s.status === "proposed" || canApprove} /> : null}
      <div className="mt-4 flex flex-wrap items-start gap-2">
        {s.status === "proposed" && canApprove ? (
          <>
            <ActionForm action={decideScript}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="seen" value={scriptSeen(s)} />
              <input type="hidden" name="decision" value="approve" />
              <Submit className="btn-ok" disabled={blocked}>Approve</Submit>
            </ActionForm>
            <ActionForm action={decideScript} className="flex items-start gap-2">
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="decision" value="reject" />
              <input name="note" className="input h-8 w-48 py-1" placeholder="why not (optional)" />
              <Submit className="btn-ghost">Reject</Submit>
            </ActionForm>
          </>
        ) : null}
        <Link href={`/scripts/${s.id}`} className="btn-ghost">Edit</Link>
        {s.status === "approved" && s.source !== "clip" ? <Link href={`/shoot/${s.id}`} className="btn-ghost">Teleprompter</Link> : null}
      </div>
    </div>
  );
}
