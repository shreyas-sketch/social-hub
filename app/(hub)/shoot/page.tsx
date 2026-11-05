import Link from "next/link";
import { raw, daysAgo } from "@/db";
import { speakers, speaker as getSpeaker } from "@/lib/speakers";
import { spokenText } from "@/lib/scripts";
import { PageHead, Empty, SpeakerTabs, Badge, ago } from "@/components/ui";
import { Uploader } from "@/components/Uploader";
import { CopyButton } from "@/components/forms";

export default function Shoot({ searchParams }: { searchParams: { speaker?: string } }) {
  const sp = speakers();
  const active = searchParams.speaker ? getSpeaker(searchParams.speaker) : undefined;
  const rows = raw<any>(
    `SELECT s.*, sp.name AS speaker, (SELECT COUNT(*) FROM videos v WHERE v.script_id = s.id) AS takes,
       (SELECT MAX(e.id) FROM edits e WHERE e.script_id = s.id) AS edit_id
     FROM scripts s JOIN speakers sp ON sp.id = s.speaker_id
     WHERE s.source <> 'clip' AND (s.status = 'approved' OR (s.status = 'shot' AND s.updated_at >= ?)) ${active ? "AND s.speaker_id = ?" : ""}
     ORDER BY s.status = 'shot', sp.id, s.decided_at`,
    active ? [daysAgo(2), active.id] : [daysAgo(2)],
  );
  return (
    <div>
      <PageHead title="Shoot" sub="Approved scripts waiting to be filmed. Phone vertical, eye level, one take per script is fine — the hub cuts the pauses." right={<Link href="/sessions" className="btn-ghost">Long sessions</Link>} />
      <SpeakerTabs base="/shoot" speakers={sp} active={active?.slug} />
      {rows.length ? (
        <div className="space-y-3">
          {rows.map((s) => (
            <div key={s.id} className="card grid gap-4 p-5 md:grid-cols-[1fr_220px]">
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <span className="font-medium text-ink">{s.speaker}</span>
                  {s.length_sec ? <Badge>~{s.length_sec}s</Badge> : null}
                  <Badge>{String(s.format || "").replace(/_/g, " ")}</Badge>
                  <span>approved {ago(s.decided_at)}</span>
                  {s.status === "shot" ? <Badge tone="green">uploaded · being cut</Badge> : null}
                </div>
                <Link href={`/scripts/${s.id}`} className="font-semibold hover:text-accent">{s.title}</Link>
                <p className="mt-1.5 text-sm font-medium text-accent">{s.hook}</p>
                <p className="mt-1 line-clamp-3 text-sm text-muted">{s.body}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/shoot/${s.id}`} className="btn-ghost">Open teleprompter</Link>
                  <CopyButton text={spokenText(s)} label="Copy script" />
                  {s.edit_id ? <Link href={`/edits/${s.edit_id}`} className="btn-ghost">See the cut</Link> : null}
                </div>
              </div>
              <div className="md:border-l md:border-line md:pl-4">
                <Uploader scriptId={s.id} label={s.takes ? "Upload another take" : "Upload raw video"} />
                <p className="mt-2 text-xs text-muted">MP4 or MOV straight from the phone. Big files are fine.</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="Nothing to shoot">Approve scripts on the Scripts page and they land here.</Empty>
      )}
    </div>
  );
}
