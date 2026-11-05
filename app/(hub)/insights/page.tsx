import Link from "next/link";
import { raw, one, daysAgo, istDay } from "@/db";
import { speakers, speaker as getSpeaker, PLATFORM_LABEL } from "@/lib/speakers";
import { rankings, learningSummary, baselineViews } from "@/lib/learn";
import { PageHead, Section, Kpi, Empty, fmt, ist, ago } from "@/components/ui";
import { latestRun, type Review } from "@/lib/agents";
import { requireUser, canApprove } from "@/lib/auth";
import { json } from "@/db";
import { ActionForm, Submit } from "@/components/forms";
import { runAgentNow, applyLaneMixAction } from "@/app/actions";
import { settingNum } from "@/lib/config";

const GROUPS: Record<string, string> = { lane: "Content lane", hook: "Hook type", length: "Length", format: "Format", captions: "Caption style" };

export default function Insights({ searchParams }: { searchParams: { speaker?: string } }) {
  const sp = speakers();
  const s = (searchParams.speaker && getSpeaker(searchParams.speaker)) || sp[0];
  if (!s) return <Empty title="No speakers yet" />;
  const rows = rankings(s.id);
  const approver = canApprove(requireUser());
  const review = latestRun("weekly_review", s.id);
  const reviewOut = json<Review | null>(review?.output, null);
  const base = baselineViews(s.id);
  const laneName = (k: string) => s.lanes.find((l) => l.key === k)?.name || k;
  const trials = one<any>(
    `SELECT COUNT(*) AS n, SUM(t.verdict = 'winner') AS w FROM trials t JOIN edits e ON e.id = t.edit_id JOIN scripts sc ON sc.id = e.script_id WHERE sc.speaker_id = ? AND t.status = 'done'`,
    [s.id],
  );
  // Clicks made in the last 30 days, on any of the speaker's tracking links (the same count as the Growth page).
  const clicks = one<{ n: number }>(`SELECT COUNT(*) AS n FROM link_clicks k JOIN links l ON l.code = k.code WHERE l.speaker_id = ? AND k.at >= ?`, [s.id, daysAgo(30)])?.n ?? 0;
  const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  const top = raw<any>(
    `SELECT p.*, a.platform FROM posts p JOIN accounts a ON a.id = p.account_id
     WHERE a.speaker_id = ? AND p.published_at >= ? AND p.views IS NOT NULL
     ORDER BY p.views DESC LIMIT 12`,
    [s.id, daysAgo(60)],
  );
  const followers = raw<any>(
    `SELECT a.platform, st.day, st.followers FROM account_stats st JOIN accounts a ON a.id = st.account_id
     WHERE a.speaker_id = ? AND st.day >= ? ORDER BY st.day`,
    [s.id, istDay(new Date(Date.now() - 35 * 864e5))],
  );
  const platforms = Array.from(new Set(followers.map((f) => f.platform)));
  const weeks = [0, 7, 14, 21, 28].map((d) => istDay(new Date(Date.now() - d * 864e5))).reverse();
  const at = (p: string, day: string) => [...followers].reverse().find((f) => f.platform === p && f.day <= day)?.followers ?? null;

  return (
    <div>
      <PageHead title="Insights" sub="What's working, per speaker. The numbers are measured from the platforms. A group with fewer than 3 finished trials is marked untested — too few to trust." />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {sp.map((x) => (
          <Link key={x.slug} href={`/insights?speaker=${x.slug}`} className={`rounded-full px-3 py-1 text-sm ${x.id === s.id ? "bg-ink text-white" : "border border-line bg-white hover:border-accent"}`}>
            {x.name.split(" ")[0]}
          </Link>
        ))}
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Finished trials" value={trials?.n ?? 0} />
        <Kpi label="Winners" value={trials?.w ?? 0} hint={trials?.n ? `${Math.round(((trials.w || 0) / trials.n) * 100)}% hit rate` : undefined} />
        <Kpi label="Median trial views" value={base.n ? fmt(base.median) : "—"} hint={base.n ? `bar for a winner: ${fmt(Math.ceil(base.median * settingNum("winner_multiplier")))}${base.n < 3 ? " · untested (under 3 trials)" : ""}` : "no finished trials yet"} />
        <Kpi label="Webinar link clicks" value={fmt(clicks)} hint="last 30 days, all tracking links" />
      </div>

      <Section
        title="Weekly Review"
        right={
          approver ? (
            <ActionForm action={runAgentNow}>
              <input type="hidden" name="agent" value="weekly_review" />
              <input type="hidden" name="speaker" value={s.id} />
              <Submit className="btn-ghost">Review now</Submit>
            </ActionForm>
          ) : null
        }
      >
        {review && reviewOut ? (
          <div className="card space-y-3 p-4 text-sm">
            <p className="font-medium">{reviewOut.summary}</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="label">Worked</div>
                <ul className="space-y-1">{arr<string>(reviewOut.worked).map((x, i) => <li key={i}>✓ {String(x)}</li>)}</ul>
              </div>
              <div>
                <div className="label">Didn&apos;t</div>
                <ul className="space-y-1">{arr<string>(reviewOut.didnt).map((x, i) => <li key={i}>✗ {String(x)}</li>)}</ul>
              </div>
            </div>
            <div>
              <div className="label">Changes for next week (the scripts are told these)</div>
              <ol className="list-decimal space-y-1 pl-5">{arr<any>(reviewOut.changes).map((c, i) => <li key={i}>{String(c?.change ?? c)} {c?.why ? <span className="text-xs text-muted">— {String(c.why)}</span> : null}</li>)}</ol>
            </div>
            {reviewOut.lane_mix && typeof reviewOut.lane_mix === "object" ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas p-3">
                <span>Suggested lane mix: {Object.entries(reviewOut.lane_mix).map(([k, v]) => `${laneName(k)} ${v}%`).join(", ")}</span>
                {approver ? (
                  <ActionForm action={applyLaneMixAction}>
                    <input type="hidden" name="runId" value={review.id} />
                    <Submit className="btn-ghost">Apply</Submit>
                  </ActionForm>
                ) : null}
              </div>
            ) : null}
            <p className="text-xs text-muted">Weekly Review · {ago(review.created_at)}{arr(reviewOut.rule_proposals).length ? " · rule ideas are waiting on the Playbook page" : ""}</p>
          </div>
        ) : (
          <Empty title="No review yet">Runs every week once there are trials to look at.</Empty>
        )}
      </Section>

      <Section title="What the scripts are being told">
        <div className="card whitespace-pre-wrap p-4 text-sm text-muted">{learningSummary(s.id)}</div>
      </Section>

      <Section title="What's working">
        {rows.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(GROUPS).map(([g, title]) => {
              const rs = rows.filter((r) => r.group === g);
              if (!rs.length) return null;
              return (
                <div key={g} className="card overflow-x-auto">
                  <div className="border-b border-line px-4 py-2 text-xs font-semibold">{title}</div>
                  <table className="w-full min-w-[560px]">
                    <thead><tr><th className="th"></th><th className="th">Trials</th><th className="th">Median views</th><th className="th">Win rate</th><th className="th">Watched</th><th className="th" title="Swiped away in the first 3 seconds">Skipped</th><th className="th" title="Shares per 1,000 reached">Sends/1K</th></tr></thead>
                    <tbody>
                      {rs.map((r) => (
                        <tr key={r.value}>
                          <td className="td">{g === "lane" ? laneName(r.value) : r.value.replace(/_/g, " ")}</td>
                          <td className="td tabular-nums">{r.trials}{r.trials < 3 ? <span className="ml-1 text-[11px] text-amber-700">untested</span> : null}</td>
                          <td className="td tabular-nums">{fmt(r.medianViews)}</td>
                          <td className="td tabular-nums">{Math.round(r.winRate * 100)}%</td>
                          <td className="td tabular-nums">{r.medianWatchPct != null ? `${r.medianWatchPct}%` : "—"}</td>
                          <td className="td tabular-nums">{r.medianSkip != null ? `${r.medianSkip}%` : "—"}</td>
                          <td className="td tabular-nums">{r.medianSends != null ? r.medianSends.toFixed(1) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty title="No finished trials yet">Rankings appear once trial reels have been read at the verdict point. Fewer than 3 trials per group = untested.</Empty>
        )}
      </Section>

      {platforms.length ? (
        <Section title="Followers, last 5 weeks">
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead><tr><th className="th">Platform</th>{weeks.map((w) => <th key={w} className="th">{new Date(`${w}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</th>)}</tr></thead>
              <tbody>
                {platforms.map((p) => (
                  <tr key={p}>
                    <td className="td">{PLATFORM_LABEL[p as keyof typeof PLATFORM_LABEL]}</td>
                    {weeks.map((w) => <td key={w} className="td tabular-nums">{fmt(at(p, w))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section title="Top posts, last 60 days">
        {top.length ? (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead><tr><th className="th">Post</th><th className="th">Where</th><th className="th">Views</th><th className="th">Likes</th><th className="th">Posted</th></tr></thead>
              <tbody>
                {top.map((p) => (
                  <tr key={p.id}>
                    <td className="td max-w-xs truncate">
                      {p.permalink ? <a className="link" href={p.permalink} target="_blank" rel="noreferrer">{(p.caption || "(no caption)").slice(0, 80)}</a> : (p.caption || "").slice(0, 80)}
                      {p.via_hub ? <span className="ml-1.5 text-[11px] text-accent">hub</span> : null}
                    </td>
                    <td className="td">{PLATFORM_LABEL[p.platform as keyof typeof PLATFORM_LABEL]}</td>
                    <td className="td tabular-nums">{fmt(p.views)}</td>
                    <td className="td tabular-nums">{fmt(p.likes)}</td>
                    <td className="td text-muted">{ist(p.published_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No post numbers yet">They arrive with the daily pull once accounts are connected.</Empty>
        )}
      </Section>
    </div>
  );
}
