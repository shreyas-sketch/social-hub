import Link from "next/link";
import { one, raw, istDay } from "@/db";
import { speakers, PLATFORMS, PLATFORM_LABEL } from "@/lib/speakers";
import { followerGrid, expiringSoon } from "@/lib/accounts";
import { recentJobErrors } from "@/lib/jobs";
import { integrationStatus, settingNum } from "@/lib/config";
import { latestRun } from "@/lib/agents";
import { json } from "@/db";
import { PageHead, Kpi, Section, Badge, fmt, ago } from "@/components/ui";
import { planRows } from "@/lib/planner";
import { LATEST_CUT } from "@/lib/edits";

const n = (sql: string, p?: unknown[]) => one<{ n: number }>(sql, p)?.n ?? 0;

export default function Today() {
  const sp = speakers();
  const grid = followerGrid();
  const cell = (sid: number, p: string) => grid.find((g) => g.speaker_id === sid && g.platform === p);
  const day = istDay();
  const exp = expiringSoon();
  const errs = recentJobErrors(6);
  const missingKeys = integrationStatus().filter((i) => !i.ok && !i.need.includes("optional"));
  const briefs = raw<any>(`SELECT b.*, s.name FROM briefs b JOIN speakers s ON s.id = b.speaker_id WHERE b.day = ? ORDER BY b.id DESC`, [day]);
  const winHours = settingNum("winner_window_hours");
  // Winners not yet sent anywhere, and verdicts still waiting on a person — both have the same window.
  const winnersToSend = raw<any>(
    `SELECT t.id, t.verdict_at FROM trials t WHERE t.status = 'done' AND (t.verdict = 'pending' OR (t.verdict = 'winner'
       AND NOT EXISTS (SELECT 1 FROM publishes p WHERE p.edit_id = t.edit_id AND p.status NOT IN ('error','skipped'))))`,
  );
  const late = winnersToSend.filter((w) => w.verdict_at && Date.now() - new Date(w.verdict_at).getTime() > winHours * 3600e3).length;
  const proposedRules = n(`SELECT COUNT(*) AS n FROM playbook_rules WHERE status = 'proposed'`);
  const trend = json<any>(latestRun("trend_scout")?.output, null);
  const accErr = raw<any>(`SELECT a.*, s.name AS speaker FROM accounts a JOIN speakers s ON s.id = a.speaker_id WHERE a.status = 'error'`);
  // v1.3: the week's plan, comments, text posts, long videos.
  const plan = planRows(day);
  const quiet = plan.flatMap((r) => r.warnings.filter((w) => w.tone === "red").map((w) => ({ who: r.sp.name, text: w.text })));
  const short = plan.reduce((a, r) => a + r.warnings.length, 0);
  const noShoot = plan.filter((r) => r.warnings.some((w) => w.text.startsWith("No shoot booked"))).map((r) => r.sp.name.split(" ")[0]);
  const dmFails = n(`SELECT COUNT(*) AS n FROM comments WHERE dm_status = 'failed' AND created_at >= ?`, [new Date(Date.now() - 864e5).toISOString()]);
  const sessionErrs = raw<any>(`SELECT se.id, se.title, se.error FROM sessions se WHERE se.status = 'error' ORDER BY se.id DESC LIMIT 3`);

  return (
    <div>
      <PageHead title="Today" sub={`${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" })} · nothing posts without a named approval`} />

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="Scripts to review" value={n(`SELECT COUNT(*) AS n FROM scripts WHERE status = 'proposed'`)} href="/scripts" />
        <Kpi label="To shoot" value={n(`SELECT COUNT(*) AS n FROM scripts WHERE status = 'approved'`)} href="/shoot" />
        <Kpi label="Cuts to check" value={n(`SELECT COUNT(*) AS n FROM edits e WHERE e.status = 'ready' AND ${LATEST_CUT}`)} href="/edits" />
        <Kpi label="Trials live" value={n(`SELECT COUNT(*) AS n FROM trials WHERE status IN ('queued','posting','live')`)} href="/trials" />
        <Kpi
          label="Winners and verdicts waiting"
          value={winnersToSend.length}
          hint={late ? `${late} past the ${winHours}h window` : `send within ${winHours}h of the verdict`}
          href="/trials"
          tone={late ? "bad" : winnersToSend.length ? "warn" : undefined}
        />
        <Kpi label="Do by hand" value={n(`SELECT COUNT(*) AS n FROM publishes WHERE status = 'manual_todo'`)} hint="YouTube uploads, IG graduations" href="/publish" tone={n(`SELECT COUNT(*) AS n FROM publishes WHERE status = 'manual_todo'`) ? "warn" : undefined} />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Text posts to review" value={n(`SELECT COUNT(*) AS n FROM text_posts WHERE status = 'proposed'`)} hint="LinkedIn and X" href="/text-posts" />
        <Kpi label="Replies to approve" value={n(`SELECT COUNT(*) AS n FROM comments WHERE needs_reply = 1 AND reply_status = 'drafted'`)} hint="drafted for comments that ask something" href="/comments" />
        <Kpi label="Long videos waiting" value={n(`SELECT COUNT(*) AS n FROM longforms WHERE status IN ('ready','manual_todo')`)} hint="to approve or upload" href="/sessions" />
        <Kpi label="This week's plan" value={short ? `${short} to look at` : "on plan"} hint={quiet.length ? `${quiet.length} platform${quiet.length > 1 ? "s" : ""} going quiet` : "posts per platform vs target"} href="/planner" tone={quiet.length ? "bad" : short ? "warn" : "ok"} />
      </div>

      {trend?.headline ? (
        <Link href="/trends" className="card mb-8 block p-4 hover:border-accent">
          <div className="text-xs font-medium text-muted">This week&apos;s trend · Trend Scout</div>
          <div className="mt-1 text-sm font-medium">{trend.headline}</div>
        </Link>
      ) : null}

      <Section title="Followers" right={<span className="text-xs text-muted">change over 7 days · measured</span>}>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                <th className="th">Speaker</th>
                {PLATFORMS.map((p) => (
                  <th key={p} className="th">{PLATFORM_LABEL[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sp.map((s) => (
                <tr key={s.id}>
                  <td className="td font-medium">
                    <Link href={`/speakers/${s.slug}`} className="hover:text-accent">{s.name}</Link>
                  </td>
                  {PLATFORMS.map((p) => {
                    const c = cell(s.id, p);
                    if (!c || c.status === "missing") return <td key={p} className="td text-xs text-red-500">not created</td>;
                    if (c.followers == null)
                      return (
                        <td key={p} className="td text-xs text-amber-600">
                          <Link href="/accounts" className="hover:underline">{c.status === "connected" ? "waiting for numbers" : "connect"}</Link>
                        </td>
                      );
                    const d = c.followers_7d != null ? c.followers - c.followers_7d : null;
                    return (
                      <td key={p} className="td tabular-nums">
                        {fmt(c.followers)}
                        {d != null ? <span className={`ml-1.5 text-xs ${d > 0 ? "text-emerald-600" : d < 0 ? "text-red-500" : "text-muted"}`}>{d > 0 ? "+" : ""}{fmt(d)}</span> : null}
                        {c.status === "error" ? <span className="ml-1.5 text-xs text-red-500">!</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Today's scripts">
          <div className="card divide-y divide-line">
            {sp.map((s) => {
              const b = briefs.find((x) => x.speaker_id === s.id);
              const count = n(`SELECT COUNT(*) AS n FROM scripts WHERE speaker_id = ? AND brief_id IN (SELECT id FROM briefs WHERE day = ?)`, [s.id, day]);
              return (
                <div key={s.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>{s.name}</span>
                  {b?.status === "error" ? (
                    <span className="text-xs text-red-600" title={b.error}>couldn't write — see Settings → Jobs</span>
                  ) : count ? (
                    <Link href={`/scripts?speaker=${s.slug}`} className="link text-xs">{count} written</Link>
                  ) : (
                    <span className="text-xs text-muted">{s.scripts_per_day ? "not yet" : "paused"}</span>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Needs attention">
          <div className="card divide-y divide-line text-sm">
            {missingKeys.length ? (
              <Link href="/settings" className="block px-4 py-2.5 hover:bg-canvas">
                <Badge tone="amber">setup</Badge> <span className="ml-1">{missingKeys.length} integration{missingKeys.length > 1 ? "s" : ""} not set up yet</span>
              </Link>
            ) : null}
            {quiet.map((q, i) => (
              <Link key={`q${i}`} href="/planner" className="block px-4 py-2.5 hover:bg-canvas">
                <Badge tone="red">plan</Badge> <span className="ml-1">{q.who} · {q.text}</span>
              </Link>
            ))}
            {noShoot.length ? (
              <Link href="/planner" className="block px-4 py-2.5 hover:bg-canvas">
                <Badge tone="amber">shoots</Badge> <span className="ml-1">No shoot booked in the next 7 days: {noShoot.join(", ")}</span>
              </Link>
            ) : null}
            {dmFails ? (
              <Link href="/comments?tab=dms" className="block px-4 py-2.5 hover:bg-canvas">
                <Badge tone="red">DMs</Badge> <span className="ml-1">{dmFails} comment-to-DM message{dmFails > 1 ? "s" : ""} failed in the last day</span>
              </Link>
            ) : null}
            {sessionErrs.map((se) => (
              <Link key={`s${se.id}`} href={`/sessions/${se.id}`} className="block px-4 py-2.5 hover:bg-canvas">
                <Badge tone="red">session</Badge> <span className="ml-1">{se.title}: {String(se.error || "").slice(0, 120)}</span>
              </Link>
            ))}
            {proposedRules ? (
              <Link href="/playbook" className="block px-4 py-2.5 hover:bg-canvas">
                <Badge tone="violet">playbook</Badge> <span className="ml-1">{proposedRules} new rule{proposedRules > 1 ? "s" : ""} proposed by the agents — switch on or skip</span>
              </Link>
            ) : null}
            {accErr.map((a) => (
              <Link key={a.id} href="/accounts" className="block px-4 py-2.5 hover:bg-canvas">
                <Badge tone="red">account</Badge> <span className="ml-1">{a.speaker} · {PLATFORM_LABEL[a.platform as keyof typeof PLATFORM_LABEL]}: {a.last_error}</span>
              </Link>
            ))}
            {exp.map((a) => (
              <Link key={a.id} href="/accounts" className="block px-4 py-2.5 hover:bg-canvas">
                <Badge tone="amber">sign-in</Badge> <span className="ml-1">{a.speaker} · {PLATFORM_LABEL[a.platform as keyof typeof PLATFORM_LABEL]} needs reconnecting by {new Date(a.token_expires_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</span>
              </Link>
            ))}
            {errs.map((j: any) => (
              <Link key={j.id} href="/settings#jobs" className="block px-4 py-2.5 hover:bg-canvas">
                <Badge tone="red">job</Badge> <span className="ml-1">{j.kind.replace(/_/g, " ")} failed {ago(j.updated_at)}: {String(j.last_error).slice(0, 120)}</span>
              </Link>
            ))}
            {!missingKeys.length && !accErr.length && !exp.length && !errs.length && !proposedRules && !quiet.length && !noShoot.length && !dmFails && !sessionErrs.length ? <div className="px-4 py-3 text-muted">All clear.</div> : null}
          </div>
        </Section>
      </div>
    </div>
  );
}
