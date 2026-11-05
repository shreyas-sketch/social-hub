import { raw } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { speakers, speaker as getSpeaker } from "@/lib/speakers";
import { outliers, READABLE } from "@/lib/refs";
import { PageHead, Section, Empty, SpeakerTabs, Badge, fmt, ago } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { editRef, toggleRef, pullWatchlist } from "@/app/actions";
import { AddCreators } from "@/components/AddCreators";

const LABEL: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", x: "X", linkedin: "LinkedIn", facebook: "Facebook", other: "Link" };

export default function Watchlist({ searchParams }: { searchParams: { speaker?: string } }) {
  const u = requireUser();
  const approver = canApprove(u);
  const sp = speakers();
  const active = searchParams.speaker ? getSpeaker(searchParams.speaker) : undefined;
  const shown = active ? sp.filter((s) => s.id === active.id) : sp;
  const outs = outliers(active?.id, 14, 1.8);
  const refs = raw<any>(
    `SELECT r.*, (SELECT COUNT(*) FROM ref_posts rp WHERE rp.ref_id = r.id) AS posts
     FROM refs r WHERE r.active >= 0 ${active ? "AND r.speaker_id = ?" : ""} ORDER BY r.active DESC, r.name`,
    active ? [active.id] : [],
  );
  return (
    <div>
      <PageHead
        title="Watchlist"
        sub="Creators each speaker learns from. Add anyone who's doing well. Posts that beat that creator's own usual by 1.8× or more feed the next morning's scripts."
        right={
          <ActionForm action={pullWatchlist}>
            {active ? <input type="hidden" name="speaker" value={active.id} /> : null}
            <Submit className="btn-ghost">Check now</Submit>
          </ActionForm>
        }
      />
      <SpeakerTabs base="/watchlist" speakers={sp} active={active?.slug} />

      <Section title="Outliers, last 14 days">
        {outs.length ? (
          <div className="card divide-y divide-line">
            {outs.map((o) => (
              <a key={o.id} href={o.permalink} target="_blank" rel="noreferrer" className="flex items-start gap-3 px-4 py-3 hover:bg-canvas">
                <Badge tone="green">{Number(o.outlier).toFixed(1)}×</Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted">{o.name} · {LABEL[o.platform] || o.platform} · for {o.speaker} · {ago(o.published_at)}</div>
                  <div className="line-clamp-2 text-sm">{o.caption || "(no caption)"}</div>
                </div>
                <div className="text-right text-xs tabular-nums text-muted">
                  {o.views != null ? <div>{fmt(o.views)} views</div> : null}
                  <div>{fmt(o.likes)} likes · {fmt(o.comments)} comments</div>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <Empty title="No outliers yet">Read every morning. Instagram creators need one connected Instagram account (Meta reads other accounts through it); YouTube needs the YouTube API key.</Empty>
        )}
      </Section>

      {shown.map((s) => {
        const list = refs.filter((r) => r.speaker_id === s.id);
        const reading = list.filter((r) => r.active === 1 && READABLE.includes(r.platform)).length;
        return (
          <Section key={s.id} title={`${s.name} — ${list.length} creator${list.length === 1 ? "" : "s"}`} right={<span className="text-xs text-muted">{reading} read every morning</span>}>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr>
                    <th className="th">Creator</th>
                    <th className="th">Followers</th>
                    <th className="th">Posts read</th>
                    <th className="th">Last read</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} className={r.active === 1 ? "" : "opacity-50"}>
                      <td className="td">
                        <a href={r.url || "#"} target="_blank" rel="noreferrer" className="font-medium hover:text-accent">{r.name}</a>
                        <div className="text-xs text-muted">
                          {LABEL[r.platform] || r.platform} · {r.handle || r.external_id || ""}
                          {!READABLE.includes(r.platform) ? " · link only" : ""}
                          {r.active === 0 ? " · paused" : ""}
                        </div>
                        {r.note ? <div className="text-xs text-muted">{r.note}</div> : null}
                        {r.last_error ? <div className="text-xs text-red-600">{r.last_error}</div> : null}
                      </td>
                      <td className="td tabular-nums">{fmt(r.followers)}</td>
                      <td className="td tabular-nums">{READABLE.includes(r.platform) ? r.posts : "—"}</td>
                      <td className="td text-muted">{READABLE.includes(r.platform) ? ago(r.last_synced_at) : "—"}</td>
                      <td className="td">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <details>
                            <summary className="btn-ghost cursor-pointer list-none">Edit</summary>
                            <ActionForm action={editRef} className="mt-2 w-64 max-w-full space-y-2 rounded-xl2 border border-line bg-white p-3 text-left">
                              <input type="hidden" name="id" value={r.id} />
                              <input name="name" className="input" defaultValue={r.name} />
                              <input name="note" className="input" defaultValue={r.note || ""} placeholder="Why this creator" />
                              <Submit>Save</Submit>
                            </ActionForm>
                          </details>
                          {approver ? (
                            <>
                              <ActionForm action={toggleRef}>
                                <input type="hidden" name="id" value={r.id} />
                                <Submit className="btn-ghost">{r.active === 1 ? "Pause" : "Resume"}</Submit>
                              </ActionForm>
                              <ActionForm action={toggleRef}>
                                <input type="hidden" name="id" value={r.id} />
                                <input type="hidden" name="do" value="remove" />
                                <Submit className="btn-danger">Remove</Submit>
                              </ActionForm>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!list.length ? (
                    <tr>
                      <td className="td text-muted" colSpan={5}>No creators yet — add some below.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <AddCreators speakerId={s.id} />
            </div>
          </Section>
        );
      })}
    </div>
  );
}
