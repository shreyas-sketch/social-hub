import { raw, one } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { integrationStatus, setting, env } from "@/lib/config";
import { recentJobErrors, jobCounts } from "@/lib/jobs";
import { AGENTS, agentRuns, agentUsage, latestRun } from "@/lib/agents";
import { PageHead, Section, Badge, ago } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { saveSettings, addUser, setRole, retryJobAction, runDailyNow, changePassword } from "@/app/actions";

const FIELDS: { key: string; label: string; hint: string; type?: string; options?: string[] }[] = [
  { key: "stats_hour_ist", label: "Pull numbers at (IST hour)", hint: "Followers, posts and the watchlist" },
  { key: "brief_hour_ist", label: "Write scripts at (IST hour)", hint: "After the numbers, so scripts use fresh data" },
  { key: "trial_read_hours", label: "Judge a trial after (hours)", hint: "Numbers are read at 3h, 6h and 12h; the verdict comes at this hour" },
  { key: "winner_window_hours", label: "Send a winner everywhere within (hours)", hint: "After the verdict; late ones are flagged on Today and Trials" },
  { key: "winner_multiplier", label: "Winner bar (× median trial views)", hint: "1.2 = beats the speaker's median by 20%" },
  { key: "min_trials_for_baseline", label: "Pick winners by hand until … trials", hint: "Before this, there's no fair median" },
  { key: "trial_graduation", label: "Instagram graduation", hint: "MANUAL = you graduate winners in the app", options: ["MANUAL", "SS_PERFORMANCE"] },
  { key: "caption_style", label: "Default captions", hint: "", options: ["bold_pop", "clean", "none"] },
  { key: "frame_mode", label: "Default for landscape footage", hint: "", options: ["crop", "fit_blur"] },
  { key: "agents_weekday", label: "Weekly agents run on (0 = Sunday … 1 = Monday)", hint: "Trend Scout, Playbook Coach and Weekly Review" },
  { key: "agents_hour_ist", label: "…at (IST hour)", hint: "After the morning numbers" },
  { key: "hook_doctor", label: "Hook Doctor on every new script", hint: "", options: ["on", "off"] },
  { key: "clips_per_session", label: "Clips to find in each long session", hint: "The Clip Picker looks for this many (3–20)" },
  { key: "trial_daily_cap", label: "Trial reels a day per account (cap)", hint: "Instagram allows about 20; hook tests count too" },
  { key: "mix_target", label: "Script mix: core / next-door / personal", hint: "Like 70/20/10 — the writer is told which kind each script should be" },
  { key: "comments_poll_minutes", label: "Read Instagram comments every (minutes)", hint: "0 = off. Each read is a few API calls per account" },
  { key: "dm_per_hour", label: "Most comment-to-DM messages per account per hour", hint: "The rest wait for the next read" },
  { key: "reply_drafts", label: "Draft replies to comments that ask something", hint: "A person approves every reply", options: ["on", "off"] },
  { key: "text_post_hour_ist", label: "Post approved text posts at (IST hour)", hint: "LinkedIn and X" },
  { key: "growth_target_followers", label: "Default follower target per platform", hint: "Change per speaker on Growth" },
  { key: "growth_target_date", label: "…by (YYYY-MM-DD)", hint: "" },
  { key: "link_platforms", label: "Platforms whose post text carries the tracking link", hint: "Comma list of linkedin, facebook, x. YouTube descriptions always get it. X: a post with a link costs about 13× more through the API ($0.20 vs $0.015) and reaches fewer people. Facebook: Meta says captions without links do best." },
];

export default function Settings() {
  const u = requireUser();
  const owner = u.role === "owner";
  const ints = integrationStatus();
  const users = raw<any>(`SELECT id, name, email, role, password_hash = 'removed' AS removed FROM users ORDER BY id`);
  const errs = recentJobErrors(20);
  const counts = jobCounts();
  const usage = agentUsage();
  const runs = agentRuns(30);
  const audit = raw<any>(`SELECT a.*, u.name FROM audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 40`);
  return (
    <div>
      <PageHead title="Settings" />

      <Section title="Integrations">
        <div className="card divide-y divide-line">
          {ints.map((i) => (
            <div key={i.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span>{i.name}</span>
              {i.ok ? <Badge tone="green">ready</Badge> : <span className="text-xs text-amber-700">needs {i.need}</span>}
            </div>
          ))}
          <div className="px-4 py-2.5 text-xs text-muted">
            Keys live in the server&apos;s environment file, not here. Redirect URL for every platform app: <code className="break-all rounded bg-canvas px-1">{env.appUrl()}/api/oauth/&lt;meta|youtube|linkedin|x&gt;/callback</code>
            {env.dryRun() ? <span className="mt-1 block font-semibold text-amber-700 sm:ml-2 sm:mt-0 sm:inline">DRY_RUN is on — nothing actually posts.</span> : null}
          </div>
          {!process.env.TOKEN_KEY ? (
            <div className="px-4 py-2.5 text-xs text-amber-800">
              TOKEN_KEY isn&apos;t set, so platform sign-ins are locked with SESSION_SECRET. Set TOKEN_KEY before connecting accounts: changing either key later means connecting every account again.
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="How the hub runs">
        <ActionForm action={saveSettings} className="card grid gap-4 p-5 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="label">{f.label}</label>
              {f.options ? (
                <select name={f.key} className="input" defaultValue={setting(f.key)} disabled={!owner}>
                  {f.options.map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <input name={f.key} className="input" defaultValue={setting(f.key)} disabled={!owner} />
              )}
              {f.hint ? <p className="mt-1 text-[11px] text-muted">{f.hint}</p> : null}
            </div>
          ))}
          <div className="sm:col-span-2">{owner ? <Submit>Save</Submit> : <p className="text-xs text-muted">Only an owner can change these.</p>}</div>
        </ActionForm>
      </Section>

      <Section title="AI agents">
        <div className="card divide-y divide-line">
          {AGENTS.map((a) => {
            const last = latestRun(a.key) || one<any>(`SELECT created_at FROM agent_runs WHERE agent = ? ORDER BY id DESC LIMIT 1`, [a.key]);
            return (
              <div key={a.key} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{a.name} <span className="text-xs font-normal text-muted">· {a.when}</span></div>
                  <div className="text-xs text-muted">{a.what}</div>
                </div>
                <div className="text-xs text-muted">{last ? `last ran ${ago(last.created_at)}` : "hasn't run yet"}</div>
              </div>
            );
          })}
          <div className="px-4 py-3 text-xs text-muted">
            <div className="mb-1 font-medium text-ink">Claude use, last 30 days (measured tokens; cost is an estimate at $3 in / $15 out per million — check the Anthropic invoice)</div>
            {usage.length ? (
              <table className="w-full max-w-xl">
                <tbody>
                  {usage.map((x: any) => (
                    <tr key={x.agent}>
                      <td className="py-0.5 pr-3">{x.agent.replace(/_/g, " ")}</td>
                      <td className="py-0.5 pr-3 tabular-nums">{x.runs} runs</td>
                      <td className="py-0.5 pr-3 tabular-nums">{Math.round(x.tin / 1000)}K in · {Math.round(x.tout / 1000)}K out</td>
                      <td className="py-0.5 tabular-nums">≈ ${((x.tin * 3 + x.tout * 15) / 1e6).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              "Nothing yet."
            )}
          </div>
          {runs.filter((r: any) => r.status === "error").slice(0, 5).map((r: any) => (
            <div key={r.id} className="px-4 py-2 text-xs text-red-600">{r.agent.replace(/_/g, " ")}{r.speaker ? ` (${r.speaker})` : ""} failed {ago(r.created_at)}: {String(r.error).slice(0, 200)}</div>
          ))}
        </div>
      </Section>

      <Section title="People">
        <div className="card divide-y divide-line">
          {users.map((x) => (
            <div key={x.id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm ${x.removed ? "opacity-40" : ""}`}>
              <span className="font-medium">{x.name}</span>
              <span className="text-muted">{x.email}</span>
              <Badge tone={x.role === "owner" ? "violet" : x.role === "admin" ? "blue" : "gray"}>{x.removed ? "removed" : x.role}</Badge>
              {owner && x.id !== u.id && !x.removed ? (
                <ActionForm action={setRole} className="ml-auto flex items-center gap-2">
                  <input type="hidden" name="id" value={x.id} />
                  <select name="role" className="input h-8 w-32 py-1" defaultValue={x.role}>
                    <option value="owner">owner</option>
                    <option value="admin">admin</option>
                    <option value="team">team</option>
                    <option value="remove">remove</option>
                  </select>
                  <Submit className="btn-ghost">Change</Submit>
                </ActionForm>
              ) : null}
            </div>
          ))}
          <div className="px-4 py-2.5 text-xs text-muted">Owner: everything. Admin: approve scripts, clips, cuts, winners, text posts, comment replies and long videos; switch DM keywords and playbook rules on; connect accounts. Team: upload, fix captions, draft replies and DM keywords, book shoots, log numbers, mark manual posts done.</div>
        </div>
        {owner ? (
          <ActionForm action={addUser} className="card mt-3 grid gap-2 p-4 sm:grid-cols-5" resetOnOk>
            <input name="name" className="input" placeholder="Name" required />
            <input name="email" type="email" className="input" placeholder="Email" required />
            <input name="password" type="text" className="input" placeholder="Password (10+)" minLength={10} required />
            <select name="role" className="input" defaultValue="team">
              <option value="team">team</option>
              <option value="admin">admin</option>
              <option value="owner">owner</option>
            </select>
            <Submit>Add person</Submit>
          </ActionForm>
        ) : null}
      </Section>

      <Section title="Jobs" right={canApprove(u) ? (
        <ActionForm action={runDailyNow}>
          <input type="hidden" name="what" value="stats" />
          <Submit className="btn-ghost">Pull all numbers now</Submit>
        </ActionForm>
      ) : null}>
        <div id="jobs" className="card divide-y divide-line">
          <div className="flex flex-wrap gap-4 px-4 py-2.5 text-sm">
            {["queued", "running", "error"].map((k) => (
              <span key={k}>{k}: <b className="tabular-nums">{counts.find((c) => c.status === k)?.n ?? 0}</b></span>
            ))}
            <span className="ml-auto text-xs text-muted">If “queued” keeps growing, the worker isn&apos;t running.</span>
          </div>
          {errs.map((j: any) => (
            <div key={j.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-medium">{j.kind.replace(/_/g, " ")}</span>
              <span className="min-w-0 break-all text-xs text-muted">{j.payload} · {ago(j.updated_at)}</span>
              <span className="w-full min-w-0 text-xs text-red-600 [overflow-wrap:anywhere] md:w-auto md:flex-1">{String(j.last_error).slice(0, 300)}</span>
              {canApprove(u) ? (
                <ActionForm action={retryJobAction}>
                  <input type="hidden" name="id" value={j.id} />
                  <Submit className="btn-ghost">Retry</Submit>
                </ActionForm>
              ) : null}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Who did what (latest 40)">
        <div className="card divide-y divide-line text-sm">
          {audit.map((a) => (
            <div key={a.id} className="flex flex-wrap gap-2 px-4 py-2">
              <span className="w-24 shrink-0 text-xs text-muted">{ago(a.at)}</span>
              <span className="font-medium">{a.name || "system"}</span>
              <span>{a.action.replace(/_/g, " ")}</span>
              <span className="text-muted">{a.entity} #{a.entity_id}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Your password">
        <ActionForm action={changePassword} className="card flex flex-wrap gap-2 p-4" resetOnOk>
          <input name="current" type="password" className="input w-56" placeholder="Current password" required />
          <input name="next" type="password" className="input w-56" placeholder="New password (10+)" minLength={10} required />
          <Submit>Change</Submit>
        </ActionForm>
      </Section>
    </div>
  );
}
