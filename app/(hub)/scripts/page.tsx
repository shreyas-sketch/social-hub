import Link from "next/link";
import { raw } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { speakers, speaker as getSpeaker } from "@/lib/speakers";
import { PageHead, Empty, SpeakerTabs } from "@/components/ui";
import { ScriptCard } from "@/components/ScriptCard";
import { ActionForm, Submit } from "@/components/forms";
import { writeScriptsNow } from "@/app/actions";

const TABS = [
  { key: "proposed", label: "To review" },
  { key: "approved", label: "Approved" },
  { key: "done", label: "Shot / in trials" },
  { key: "rejected", label: "Rejected" },
];

export default function Scripts({ searchParams }: { searchParams: { speaker?: string; status?: string } }) {
  const u = requireUser();
  const sp = speakers();
  const active = searchParams.speaker ? getSpeaker(searchParams.speaker) : undefined;
  const status = searchParams.status || "proposed";
  const statusSql =
    status === "done" ? `s.status IN ('shot','edited','trial','winner','not_winner')` : status === "all" ? "1=1" : `s.status = @status`;
  const rows = raw<any>(
    `SELECT s.*, sp.name AS speaker, rp.permalink AS ref_link, rp.outlier AS ref_outlier, r.name AS ref_name
     FROM scripts s JOIN speakers sp ON sp.id = s.speaker_id
     LEFT JOIN ref_posts rp ON rp.id = s.inspired_by LEFT JOIN refs r ON r.id = rp.ref_id
     WHERE ${statusSql} ${active ? "AND s.speaker_id = @sid" : ""}
     ORDER BY s.created_at DESC LIMIT 120`,
    { status, sid: active?.id },
  );
  const laneName = (sid: number, key: string) => sp.find((x) => x.id === sid)?.lanes.find((l) => l.key === key)?.name;
  const extra = `status=${status}`;

  return (
    <div>
      <PageHead
        title="Scripts"
        sub="Written every morning from what's working for us and the watchlist. Approve the ones worth shooting."
        right={
          canApprove(u) ? (
            <ActionForm action={writeScriptsNow} className="flex items-center gap-2">
              {active ? <input type="hidden" name="speaker" value={active.id} /> : null}
              <input name="count" type="number" min={1} max={6} defaultValue={active ? 3 : undefined} placeholder="n" className="input h-8 w-16 py-1" title="How many (blank = each speaker's daily number)" />
              <Submit className="btn-primary">Write {active ? `for ${active.name.split(" ")[0]}` : "for everyone"} now</Submit>
            </ActionForm>
          ) : null
        }
      />
      <SpeakerTabs base="/scripts" speakers={sp} active={active?.slug} extra={extra} />
      <div className="mb-5 flex gap-4 border-b border-line text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/scripts?status=${t.key}${active ? `&speaker=${active.slug}` : ""}`}
            className={`-mb-px border-b-2 pb-2 ${status === t.key ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {rows.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((s) => (
            <ScriptCard key={s.id} s={s} canApprove={canApprove(u)} laneName={laneName(s.speaker_id, s.lane)} />
          ))}
        </div>
      ) : (
        <Empty title="Nothing here">
          {status === "proposed" ? "New scripts arrive every morning (time set in Settings), or press “Write now”." : "No scripts in this list yet."}
        </Empty>
      )}
    </div>
  );
}
