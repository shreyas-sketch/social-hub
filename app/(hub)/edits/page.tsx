import Link from "next/link";
import { raw, json } from "@/db";
import { speakers, speaker as getSpeaker } from "@/lib/speakers";
import { LATEST_CUT } from "@/lib/edits";
import { PageHead, Empty, SpeakerTabs, Status, Section, ago } from "@/components/ui";

const file = (p: string | null) => (p ? `/api/files?p=${encodeURIComponent(p)}` : null);

function Grid({ rows }: { rows: any[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {rows.map((e) => (
        <Link key={e.id} href={`/edits/${e.id}`} className="card overflow-hidden hover:border-accent">
          <div className="relative aspect-[9/16] bg-canvas">
            {e.thumb_path ? <img src={file(e.thumb_path)!} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-xs text-muted">{e.status === "error" ? "failed" : "cutting…"}</div>}
            <div className="absolute left-2 top-2"><Status s={e.status} /></div>
            {json<string[]>(e.warnings, []).length ? <div className="absolute right-2 top-2 rounded bg-amber-400 px-1.5 text-[11px] font-semibold text-ink">!</div> : null}
          </div>
          <div className="p-2.5">
            <div className="truncate text-xs text-muted">{e.speaker} · v{e.version}{e.duration ? ` · ${Math.round(e.duration)}s` : ""}</div>
            <div className="line-clamp-2 text-sm font-medium leading-snug">{e.title}</div>
            <div className="mt-1 text-[11px] text-muted">{ago(e.updated_at)}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function Edits({ searchParams }: { searchParams: { speaker?: string } }) {
  const sp = speakers();
  const active = searchParams.speaker ? getSpeaker(searchParams.speaker) : undefined;
  const rows = raw<any>(
    `SELECT e.*, s.title, sp.name AS speaker FROM edits e JOIN scripts s ON s.id = e.script_id JOIN speakers sp ON sp.id = s.speaker_id
     WHERE ${LATEST_CUT} ${active ? "AND s.speaker_id = ?" : ""}
     ORDER BY e.updated_at DESC LIMIT 200`,
    active ? [active.id] : [],
  );
  const by = (st: string[]) => rows.filter((r) => st.includes(r.status));
  const ready = by(["ready"]);
  const working = by(["queued", "running"]);
  const errors = by(["error"]);
  const approved = by(["approved"]).slice(0, 20);
  const rejected = by(["rejected"]).slice(0, 10);
  return (
    <div>
      <PageHead title="Edits" sub="Every upload is cut automatically: pauses out, 9:16, captions, hook on screen, loudness levelled. Check each one before it goes out." />
      <SpeakerTabs base="/edits" speakers={sp} active={active?.slug} />
      {!rows.length ? <Empty title="No cuts yet">Upload a raw video on the Shoot page.</Empty> : null}
      {ready.length ? <Section title={`Ready to check (${ready.length})`}><Grid rows={ready} /></Section> : null}
      {working.length ? <Section title="Being cut"><Grid rows={working} /></Section> : null}
      {errors.length ? <Section title="Failed"><Grid rows={errors} /></Section> : null}
      {approved.length ? <Section title="Approved recently"><Grid rows={approved} /></Section> : null}
      {rejected.length ? <Section title="Not usable"><Grid rows={rejected} /></Section> : null}
    </div>
  );
}
