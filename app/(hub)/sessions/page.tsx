import Link from "next/link";
import { raw, istDay } from "@/db";
import { requireUser } from "@/lib/auth";
import { speakers } from "@/lib/speakers";
import { sessionRows, SESSION_KINDS } from "@/lib/sessions";
import { PageHead, Section, Empty, Status, Badge, ago } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { newSession } from "@/app/actions";

const STATUS_TEXT: Record<string, string> = {
  waiting: "waiting for the recording",
  transcribing: "writing the transcript",
  picking: "picking clips",
  ready: "clips ready",
  error: "needs a look",
};

export default function Sessions() {
  requireUser();
  const sp = speakers();
  const rows = sessionRows();
  const booked = raw<any>(`SELECT sh.*, sp.name AS speaker FROM shoots sh JOIN speakers sp ON sp.id = sh.speaker_id WHERE sh.kind = 'long_session' AND sh.status = 'planned' AND sh.day >= ? ORDER BY sh.day LIMIT 20`, [istDay(new Date(Date.now() - 3 * 864e5))]);

  return (
    <div>
      <PageHead
        title="Long sessions"
        sub="One 60–90 minute talk, Q&A or podcast per speaker a week. The hub writes the transcript, picks 10–15 clips (each one waits for your approval like a script) and plans one YouTube long video from the same recording."
      />

      <Section title="Start a session">
        <ActionForm action={newSession} className="card grid gap-3 p-4 md:grid-cols-[180px_160px_1fr_200px_auto]">
          <select name="speakerId" className="input" required defaultValue="">
            <option value="" disabled>Speaker</option>
            {sp.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select name="kind" className="input" defaultValue="talk">
            {Object.entries(SESSION_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input name="title" className="input" placeholder="What it's about — e.g. 'Why salaried traders lose money'" required />
          <input name="guest" className="input" placeholder="Guest (optional)" />
          <Submit>Create and upload</Submit>
        </ActionForm>
        <p className="mt-2 text-xs text-muted">Record at 1080p, phone or camera on a stand, a clip-on mic, landscape is best for YouTube (the clips are reframed to vertical). Files up to 20 GB.</p>
      </Section>

      {booked.length ? (
        <Section title="Booked long sessions">
          <div className="card divide-y divide-line text-sm">
            {booked.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="font-medium">{b.speaker}</span>
                <span className="text-muted">{new Date(`${b.day}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}{b.time ? ` · ${b.time}` : ""}{b.place ? ` · ${b.place}` : ""}</span>
                <ActionForm action={newSession} className="ml-auto flex items-center gap-2">
                  <input type="hidden" name="speakerId" value={b.speaker_id} />
                  <input type="hidden" name="shootId" value={b.id} />
                  <input type="hidden" name="kind" value="talk" />
                  <input name="title" className="input h-8 w-64 py-1" placeholder="Title, once it's recorded" required />
                  <Submit className="btn-ghost">Upload the recording</Submit>
                </ActionForm>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Sessions">
        {rows.length ? (
          <div className="card divide-y divide-line">
            {rows.map((r) => (
              <Link key={r.id} href={`/sessions/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-canvas">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-muted">
                    {r.speaker} · {SESSION_KINDS[r.kind] || r.kind}
                    {r.guest ? ` with ${r.guest}` : ""}
                    {r.duration ? ` · ${Math.round(r.duration / 60)} min` : ""} · {ago(r.created_at)}
                  </div>
                </div>
                <Badge tone={r.status === "error" ? "red" : r.status === "ready" ? "green" : "amber"}>{STATUS_TEXT[r.status] || r.status}</Badge>
                {r.clips ? <span className="text-xs text-muted">{r.clips} clips · {r.to_review} to review · {r.approved} approved</span> : null}
                {r.long_status ? <span className="text-xs text-muted">long video: <Status s={r.long_status} /></span> : null}
              </Link>
            ))}
          </div>
        ) : (
          <Empty title="No sessions yet">Start one above, or book a long session on the Planner.</Empty>
        )}
      </Section>
    </div>
  );
}
