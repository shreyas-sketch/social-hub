import Link from "next/link";
import { raw, istDay } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { env } from "@/lib/config";
import { speakers, PLATFORM_LABEL } from "@/lib/speakers";
import { growthCard, weeklyFollowers, targetsFor, boostRows, GROWTH_PLATFORMS, type GrowthPlatform, type Pace } from "@/lib/growth";
import { PageHead, Section, Badge, Kpi, fmt } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { GrowthLines, type GrowthSeries } from "@/components/GrowthLines";
import { saveTargetsAction, addSignupAction, saveBoostAction } from "@/app/actions";

// Categorical slots 1–5 of the reference palette (validated: adjacent CVD ΔE ≥ 9.1, normal-vision ≥ 19.6 on white).
const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];

const rate = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${Math.abs(v) >= 10 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(1)}`);
const pctOf = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const per1k = (v: number | null) => (v == null ? "—" : v.toFixed(v >= 10 ? 0 : 1));
const shortDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const fullDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const rupees = (v: number | null) => (v == null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")}`);

function PaceRow({ p }: { p: Pace }) {
  const tone = p.ratio == null ? "gray" : p.ratio >= 1 ? "green" : p.ratio >= 0.25 ? "amber" : "red";
  return (
    <tr>
      <td className="td">{PLATFORM_LABEL[p.platform]}</td>
      <td className="td text-right tabular-nums">{fmt(p.followers)}</td>
      <td className="td text-right tabular-nums">{rate(p.net7)}</td>
      <td className="td text-right tabular-nums">{rate(p.net30)}{p.window30 && p.window30 < 28 ? <span className="text-muted"> ({p.window30}d)</span> : null}</td>
      <td className="td text-right tabular-nums">{p.needPerDay == null ? "—" : Math.round(p.needPerDay).toLocaleString("en-IN")}</td>
      <td className="td text-right">{p.ratio == null ? <span className="text-muted">—</span> : <Badge tone={tone as any}>{pctOf(p.ratio)}</Badge>}</td>
      <td className="td text-xs text-muted">{fmt(p.target.followers)} by {fullDay(p.target.by)}</td>
      <td className="td text-xs">{p.eta === "reached" ? <Badge tone="green">reached</Badge> : p.eta ? fullDay(p.eta) : <span className="text-muted">not at this pace</span>}</td>
    </tr>
  );
}

export default function Growth({ searchParams }: { searchParams: { p?: string } }) {
  const u = requireUser();
  const approver = canApprove(u);
  const sp = speakers();
  const platform: GrowthPlatform = (GROWTH_PLATFORMS as readonly string[]).includes(searchParams.p || "") ? (searchParams.p as GrowthPlatform) : "instagram";

  // The chart: growth since the first week each account has numbers for, so big and small accounts share an axis.
  let weeks: string[] = [];
  const series: GrowthSeries[] = [];
  const tooSmall: string[] = [];
  sp.forEach((s, i) => {
    const w = weeklyFollowers(s.id, 12);
    weeks = w.ends.map(shortDay);
    const line = w.series.find((x) => x.platform === platform);
    if (!line) return;
    const base = line.values.find((v) => v != null) ?? null;
    if (base == null) return;
    if (base < 100) {
      tooSmall.push(s.name.split(" ")[0]);
      return;
    }
    series.push({ name: s.name.split(" ")[0], color: COLORS[i % COLORS.length], growth: line.values.map((v) => (v == null ? null : ((v - base) / base) * 100)), followers: line.values });
  });

  const cards = sp.map((s) => ({ s, c: growthCard(s), t: targetsFor(s) }));
  const winners = raw<any>(
    `SELECT t.id, s.title, sp.name AS speaker, t.posted_at FROM trials t JOIN edits e ON e.id = t.edit_id JOIN scripts s ON s.id = e.script_id JOIN speakers sp ON sp.id = s.speaker_id
     WHERE t.verdict = 'winner' ORDER BY t.id DESC LIMIT 60`,
  );
  const boosts = boostRows();

  return (
    <div>
      <PageHead
        title="Growth"
        sub="Where each account stands against its target, and the speaker's own numbers behind it. Follower counts are measured; “needed a day” and “at this pace” are our arithmetic on them."
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {GROWTH_PLATFORMS.map((p) => (
          <Link key={p} href={`/growth?p=${p}`} className={`rounded-full px-3 py-1 text-sm ${p === platform ? "bg-ink text-white" : "border border-line bg-white hover:border-accent"}`}>
            {PLATFORM_LABEL[p]}
          </Link>
        ))}
      </div>

      <Section title={`${PLATFORM_LABEL[platform]}: growth since the first week, last 12 weeks`} right={<span className="text-xs text-muted">measured · weekly</span>}>
        <div className="card p-4">
          {series.length ? (
            <>
              <GrowthLines weeks={weeks} series={series} />
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer select-none text-accent">See the numbers</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr>
                        <th className="th">Week ending</th>
                        {series.map((s) => <th key={s.name} className="th text-right">{s.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {weeks.map((w, i) => (
                        <tr key={w}>
                          <td className="td">{w}</td>
                          {series.map((s) => <td key={s.name} className="td text-right tabular-nums">{fmt(s.followers[i])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <p className="py-6 text-center text-sm text-muted">No follower numbers for {PLATFORM_LABEL[platform]} yet. They're read every morning once the accounts are connected.</p>
          )}
          {tooSmall.length ? <p className="mt-2 text-xs text-muted">Not on the chart (under 100 followers at the start, so percentages would mislead): {tooSmall.join(", ")}.</p> : null}
        </div>
      </Section>

      <div className="space-y-6">
        {cards.map(({ s, c, t }) => (
          <div key={s.id} className="card p-5">
            <div className="mb-3 font-semibold">{s.name}</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr>
                    <th className="th">Platform</th>
                    <th className="th text-right">Followers</th>
                    <th className="th text-right">Net a day (7d)</th>
                    <th className="th text-right">Net a day (30d)</th>
                    <th className="th text-right">Needed a day</th>
                    <th className="th text-right">Pace</th>
                    <th className="th">Target</th>
                    <th className="th">At this pace</th>
                  </tr>
                </thead>
                <tbody>
                  {c.platforms.filter((p) => p.followers != null).map((p) => <PaceRow key={p.platform} p={p} />)}
                </tbody>
              </table>
              {!c.platforms.some((p) => p.followers != null) ? <p className="py-2 text-sm text-muted">No follower numbers yet.</p> : null}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi label="Instagram views (30d)" value={fmt(c.igViews.total)} hint={`${c.igViews.posts} posts · median ${fmt(c.igViews.median)}`} />
              <Kpi label="Follows per 1,000 views" value={per1k(c.followsPer1k)} hint="approx: net followers ÷ views (30d)" />
              <Kpi label="Top 10% of posts' share" value={pctOf(c.igViews.top10Share)} hint={c.igViews.top10Share == null ? "needs 5+ posts" : "of all views — high = breakouts carry it"} />
              <Kpi label="Trial win rate (30d)" value={pctOf(c.winRate)} hint={`${c.trials} decided`} />
              <Kpi label="Link clicks (30d)" value={fmt(c.clicks)} hint={`${per1k(c.clicksPer1k)} per 1,000 views · ${fmt(c.dms)} DMs sent`} />
              <Kpi label="Webinar sign-ups (30d)" value={fmt(c.signups)} hint={`${per1k(c.signupsPer1k)} per 1,000 views`} />
            </div>

            {approver ? (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer select-none text-xs text-accent">Change {s.name.split(" ")[0]}&apos;s follower targets</summary>
                <ActionForm action={saveTargetsAction} className="mt-2 grid gap-2 sm:grid-cols-5">
                  <input type="hidden" name="speakerId" value={s.id} />
                  {GROWTH_PLATFORMS.map((p) => (
                    <div key={p} className="space-y-1">
                      <label className="label">{PLATFORM_LABEL[p]}</label>
                      <input name={`${p}_followers`} className="input" defaultValue={t[p].followers} />
                      <input name={`${p}_by`} type="date" className="input" defaultValue={t[p].by} />
                    </div>
                  ))}
                  <div className="sm:col-span-5"><Submit>Save targets</Submit></div>
                </ActionForm>
              </details>
            ) : null}
          </div>
        ))}
      </div>

      <div id="boosts" className="mt-8 grid gap-6 lg:grid-cols-2">
        <Section title="Webinar sign-ups">
          <ActionForm action={addSignupAction} className="card grid gap-2 p-4 sm:grid-cols-2" resetOnOk>
            <select name="speakerId" className="input" required defaultValue="">
              <option value="" disabled>Speaker</option>
              {sp.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input name="day" type="date" className="input" defaultValue={istDay()} required />
            <input name="count" type="number" min={1} className="input" placeholder="How many" required />
            <input name="content" className="input" placeholder="From (optional) — e.g. bio, DM, a reel" />
            <div className="sm:col-span-2"><Submit>Add</Submit></div>
          </ActionForm>
          <p className="mt-2 text-xs text-muted [overflow-wrap:anywhere]">
            Or have the webinar page send them: <code className="rounded bg-canvas px-1">POST {env.appUrl()}/api/signups</code> with the header <code className="rounded bg-canvas px-1">x-hub-key</code> and
            {" "}<code className="rounded bg-canvas px-1">{`{"signups":[{"utm_id":"…","utm_term":"…","utm_content":"…","ref":"order id"}]}`}</code>. Every tracking link already adds utm_id (the link) and utm_term (the speaker).
          </p>
        </Section>

        <Section title="Paid boosts of winners">
          <ActionForm action={saveBoostAction} className="card grid gap-2 p-4 sm:grid-cols-3" resetOnOk>
            <select name="speakerId" className="input" required defaultValue="">
              <option value="" disabled>Speaker</option>
              {sp.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select name="trialId" className="input sm:col-span-2" defaultValue="">
              <option value="">Which winning reel (optional)</option>
              {winners.map((w) => <option key={w.id} value={w.id}>{w.speaker.split(" ")[0]} · {w.title}</option>)}
            </select>
            <select name="platform" className="input" defaultValue="instagram">
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
            </select>
            <label className="text-xs text-muted">Started<input name="started_on" type="date" className="input mt-0.5" required aria-label="Boost started on" /></label>
            <label className="text-xs text-muted">Ended (blank if still running)<input name="ended_on" type="date" className="input mt-0.5" aria-label="Boost ended on" /></label>
            <input name="spend" className="input" placeholder="Spent (₹)" required />
            <input name="follows" className="input" placeholder="Follows (Ads Manager)" />
            <input name="clicks" className="input" placeholder="Link clicks" />
            <input name="signups" className="input" placeholder="Sign-ups" />
            <input name="audience" className="input sm:col-span-2" placeholder="Audience — e.g. India, 35–55" />
            <div className="sm:col-span-3"><Submit>Log the boost</Submit></div>
          </ActionForm>
          <p className="mt-2 text-xs text-muted">
            Boost in Ads Manager by hand, then log it here. The research estimate was ₹100–550 per follower (untested), so boosts suit pushing winners and the webinar, not buying millions of followers.
            Deepak and Siddharth: check Meta&apos;s rules for crypto and financial ads in India first, and no SEBI-registered partner may pay to promote their content. I&apos;m not a lawyer.
          </p>
        </Section>
      </div>

      {boosts.length ? (
        <Section title="Boosts so far">
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr>
                  <th className="th">Speaker · reel</th>
                  <th className="th">Dates</th>
                  <th className="th text-right">Spent</th>
                  <th className="th text-right">Follows</th>
                  <th className="th text-right">₹ per follow</th>
                  <th className="th text-right">₹ per click</th>
                  <th className="th text-right">₹ per sign-up</th>
                  <th className="th text-right">Follower change</th>
                </tr>
              </thead>
              <tbody>
                {boosts.map((b) => (
                  <tr key={b.id}>
                    <td className="td">{b.speaker}{b.reel ? <span className="text-muted"> · {b.reel}</span> : null}</td>
                    <td className="td text-xs">{shortDay(b.started_on)}{b.ended_on ? `–${shortDay(b.ended_on)}` : " · running"}</td>
                    <td className="td text-right tabular-nums">{rupees(b.spend_inr)}</td>
                    <td className="td text-right tabular-nums">{fmt(b.follows)}</td>
                    <td className="td text-right tabular-nums">{rupees(b.perFollow)}</td>
                    <td className="td text-right tabular-nums">{rupees(b.perClick)}</td>
                    <td className="td text-right tabular-nums">{rupees(b.perSignup)}</td>
                    <td className="td text-right tabular-nums">{b.followerChange == null ? "—" : rate(b.followerChange)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-2 text-[11px] text-muted">Spend, follows, clicks and sign-ups are typed in from Ads Manager. Follower change is measured from the account, so it includes people who came without the ad.</p>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
