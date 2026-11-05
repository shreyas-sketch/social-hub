import Link from "next/link";
import { one, raw } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { publishRows } from "@/lib/publish";
import { PLATFORM_LABEL } from "@/lib/speakers";
import { PageHead, Empty, Section, Status, ago } from "@/components/ui";
import { ActionForm, Submit, CopyButton } from "@/components/forms";
import { manualDone, retryPost } from "@/app/actions";

const file = (p: string | null) => (p ? `/api/files?p=${encodeURIComponent(p)}` : "");
const label = (p: string) => PLATFORM_LABEL[p as keyof typeof PLATFORM_LABEL] || p;

function Steps({ p }: { p: any }) {
  if (p.platform === "instagram") {
    const trial = one<any>(`SELECT permalink FROM trials WHERE edit_id = ? ORDER BY id DESC LIMIT 1`, [p.edit_id]);
    return (
      <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs text-muted">
        <li>Open the trial reel in the Instagram app{trial?.permalink ? <> (<a className="link" href={trial.permalink} target="_blank" rel="noreferrer">link</a>)</> : null}.</li>
        <li>Tap “Share to followers” to graduate it. Meta has no way to do this from outside the app.</li>
        <li>Come back and press Done.</li>
      </ol>
    );
  }
  if (p.platform === "youtube") {
    return (
      <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs text-muted">
        <li>Download the reel. Open YouTube Studio → Create → Upload.</li>
        <li>Paste the title and description below. Under 3 minutes and vertical, so it becomes a Short.</li>
        <li>Paste the Short’s link here and press Done (that’s how its numbers get tracked).</li>
      </ol>
    );
  }
  return <p className="mt-2 text-xs text-muted">Post it by hand, then paste the link and press Done.</p>;
}

export default function Publish() {
  const u = requireUser();
  const approver = canApprove(u);
  const rows = publishRows();
  const todo = rows.filter((r) => r.status === "manual_todo");
  const errors = rows.filter((r) => r.status === "error");
  const moving = rows.filter((r) => r.status === "queued" || r.status === "running");
  const done = rows.filter((r) => r.status === "done").slice(0, 40);
  const skipped = rows.filter((r) => r.status === "skipped").slice(0, 10);
  const longTodo = raw<any>(`SELECT l.id, l.title, l.session_id, l.status, sp.name AS speaker FROM longforms l JOIN speakers sp ON sp.id = l.speaker_id WHERE l.status IN ('manual_todo','error') AND l.approved_by IS NOT NULL ORDER BY l.id DESC`);

  return (
    <div>
      <PageHead title="Publish" sub="Winners going out to every platform. Facebook, LinkedIn and X post from here; YouTube and the Instagram graduation are a two-minute job by hand." />
      {!rows.length ? <Empty title="Nothing sent yet">Mark a trial as a winner and press “Send everywhere”.</Empty> : null}

      {longTodo.length ? (
        <Section title={`YouTube long videos to upload (${longTodo.length})`}>
          <div className="card divide-y divide-line text-sm">
            {longTodo.map((l) => (
              <Link key={l.id} href={`/sessions/${l.session_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-canvas">
                <span className="font-medium">{l.speaker}</span>
                <span className="min-w-0 flex-1 truncate">{l.title}</span>
                <Status s={l.status} />
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      {todo.length ? (
        <Section title={`Do by hand (${todo.length})`}>
          <div className="space-y-3">
            {todo.map((p) => (
              <div key={p.id} className="card flex gap-4 p-4">
                {p.thumb_path ? <img src={file(p.thumb_path)} alt="" className="aspect-[9/16] w-20 shrink-0 rounded-lg object-cover" /> : null}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span className="font-medium text-ink">{p.speaker}</span>
                    <span>·</span>
                    <span className="font-medium text-ink">{label(p.platform)}</span>
                    <span>sent {ago(p.created_at)}</span>
                  </div>
                  <div className="truncate font-medium">{p.script_title}</div>
                  <Steps p={p} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {p.platform !== "instagram" ? (
                      <>
                        <a href={file(p.output_path) + "&download=1"} className="btn-ghost">Download reel</a>
                        {p.title ? <CopyButton text={p.title} label="Copy title" /> : null}
                        <CopyButton text={p.caption || ""} label="Copy description" />
                      </>
                    ) : null}
                  </div>
                  <ActionForm action={manualDone} className="mt-3 flex flex-wrap gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    {p.platform !== "instagram" ? <input name="url" className="input h-8 w-72 py-1" placeholder="link to the post" /> : null}
                    <Submit className="btn-ok">Done</Submit>
                  </ActionForm>
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {errors.length ? (
        <Section title="Failed">
          <div className="card divide-y divide-line">
            {errors.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="font-medium">{p.speaker} · {label(p.platform)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-red-600">{p.error}</span>
                {approver ? (
                  <ActionForm action={retryPost}>
                    <input type="hidden" name="id" value={p.id} />
                    <Submit className="btn-ghost">Try again</Submit>
                  </ActionForm>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {moving.length ? (
        <Section title="Posting">
          <div className="card divide-y divide-line text-sm">
            {moving.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                <span>{p.speaker} · {label(p.platform)} · {p.script_title}</span>
                <Status s={p.status} />
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {done.length ? (
        <Section title="Posted">
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr><th className="th">Reel</th><th className="th">Where</th><th className="th">When</th><th className="th">Link clicks</th><th className="th"></th></tr>
              </thead>
              <tbody>
                {done.map((p) => (
                  <tr key={p.id}>
                    <td className="td"><Link href={`/edits/${p.edit_id}`} className="hover:text-accent">{p.speaker} · {p.script_title}</Link></td>
                    <td className="td">{label(p.platform)}{p.mode === "manual" ? <span className="ml-1 text-xs text-muted">(by hand)</span> : null}</td>
                    <td className="td text-muted">{ago(p.done_at)}</td>
                    <td className="td tabular-nums">{p.link_code ? p.clicks ?? 0 : "—"}</td>
                    <td className="td">{p.permalink ? <a className="link" href={p.permalink} target="_blank" rel="noreferrer">open</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {skipped.length ? (
        <Section title="Skipped">
          <div className="card divide-y divide-line text-sm">
            {skipped.map((p) => (
              <div key={p.id} className="px-4 py-2.5 text-muted">{p.speaker} · {label(p.platform)} — {p.error}</div>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
