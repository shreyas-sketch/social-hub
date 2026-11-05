import Link from "next/link";
import { raw } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { trialRows } from "@/lib/trials";
import { settingNum } from "@/lib/config";
import { PLATFORMS, PLATFORM_LABEL } from "@/lib/speakers";
import { env } from "@/lib/config";
import { PageHead, Empty, Section, Status, Badge, fmt, ist } from "@/components/ui";
import { captionFor, linkPlatforms } from "@/lib/publish";
import { retestHook } from "@/app/actions";
import type { DoctorNote } from "@/lib/agents";
import { json } from "@/db";
import { ActionForm, Submit } from "@/components/forms";
import { verdict, retryTrial, sendWinner } from "@/app/actions";

const file = (p: string | null) => (p ? `/api/files?p=${encodeURIComponent(p)}` : "");

/** Hours left in the window to act on a verdict (negative = late). */
function Window({ since, hours, verb }: { since: string | null; hours: number; verb: string }) {
  if (!since) return null;
  const left = Math.round(hours - (Date.now() - new Date(since).getTime()) / 3600e3);
  return left >= 0 ? <Badge tone="amber">{verb} within {left}h</Badge> : <Badge tone="red">{verb} — {-left}h late</Badge>;
}

function Numbers({ t }: { t: any }) {
  const watchPct = t.avg_watch_ms && t.duration ? Math.round((t.avg_watch_ms / 1000 / t.duration) * 100) : null;
  const cells = [
    ["Views", fmt(t.views)],
    ["Reach", fmt(t.reach)],
    ["Likes", fmt(t.likes)],
    ["Shares", fmt(t.shares)],
    ["Saves", fmt(t.saves)],
    ["Avg watch", t.avg_watch_ms ? `${(t.avg_watch_ms / 1000).toFixed(1)}s${watchPct != null ? ` (${watchPct}%)` : ""}` : "—"],
    ["Skipped in 3s", t.skip_rate != null ? `${Math.round(t.skip_rate)}%` : "—"],
    ["Sends / 1K reached", t.reach && t.shares != null ? ((t.shares / t.reach) * 1000).toFixed(1) : "—"],
  ];
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs sm:grid-cols-8">
      {cells.map(([k, v]) => (
        <div key={k}>
          <div className="text-muted">{k}</div>
          <div className="font-semibold tabular-nums">{v}</div>
        </div>
      ))}
    </div>
  );
}

export default function Trials() {
  const u = requireUser();
  const approver = canApprove(u);
  const rows = trialRows("all");
  const sent = raw<any>(`SELECT edit_id, platform, status FROM publishes`);
  const accs = raw<any>(`SELECT speaker_id, platform, status FROM accounts`);
  /** Instagram (graduate) and YouTube (until the audit) are manual steps, so they always go on the list. */
  const ready = (speakerId: number, p: string) =>
    p === "instagram" || (p === "youtube" && !env.youtubeUploadEnabled()) || accs.some((a) => a.speaker_id === speakerId && a.platform === p && a.status === "connected");
  const sentFor = (editId: number) => sent.filter((p) => p.edit_id === editId);
  const live = rows.filter((t) => ["queued", "posting", "live"].includes(t.status));
  const toDecide = rows.filter((t) => t.status === "done" && t.verdict === "pending");
  const isSent = (editId: number) => sent.some((p) => p.edit_id === editId && p.status !== "error" && p.status !== "skipped");
  const winners = rows.filter((t) => t.verdict === "winner" && !isSent(t.edit_id));
  const sentWinners = rows.filter((t) => t.verdict === "winner" && isSent(t.edit_id)).slice(0, 30);
  const winHours = settingNum("winner_window_hours");
  const others = rows.filter((t) => t.verdict === "not_winner").slice(0, 20);
  const errors = rows.filter((t) => t.status === "error");
  const hours = settingNum("trial_read_hours");

  const Row = ({ t, children }: { t: any; children?: React.ReactNode }) => (
    <div className="card flex gap-4 p-4">
      <Link href={`/edits/${t.edit_id}`} className="w-20 shrink-0">
        {t.thumb_path ? <img src={file(t.thumb_path)} alt="" className="aspect-[9/16] w-full rounded-lg object-cover" /> : <div className="aspect-[9/16] rounded-lg bg-canvas" />}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span className="font-medium text-ink">{t.speaker}</span>
          <Status s={t.status === "done" ? t.verdict : t.status} />
          {t.mode === "regular" ? <Badge tone="blue">{json<any>(t.edit_settings, {}).collaborators?.length ? "normal collab reel" : "normal reel (under 1,000 followers)"}</Badge> : null}
          {json<any>(t.edit_settings, {}).hookText ? <Badge tone="violet">hook {t.variant_of ? "test" : "re-test"}: {String(json<any>(t.edit_settings, {}).hookText).slice(0, 40)}</Badge> : null}
          {t.source === "clip" ? <Badge>clip from a long session</Badge> : null}
          <span>posted {ist(t.posted_at)}</span>
          {t.permalink ? <a href={t.permalink} target="_blank" rel="noreferrer" className="link">open</a> : null}
        </div>
        <div className="truncate font-medium">{t.title}</div>
        <div className="mt-2"><Numbers t={t} /></div>
        {t.verdict_reason ? <p className="mt-2 text-xs text-muted">{t.verdict_reason}</p> : null}
        {t.error ? <p className="mt-2 text-xs text-red-600">{t.error}</p> : null}
        {children}
      </div>
    </div>
  );

  const VerdictButtons = ({ t }: { t: any }) =>
    approver ? (
      <div className="mt-3 flex gap-2">
        <ActionForm action={verdict}>
          <input type="hidden" name="trialId" value={t.id} />
          <input type="hidden" name="verdict" value="winner" />
          <Submit className="btn-ok">Winner</Submit>
        </ActionForm>
        <ActionForm action={verdict}>
          <input type="hidden" name="trialId" value={t.id} />
          <input type="hidden" name="verdict" value="not_winner" />
          <Submit className="btn-ghost">Not a winner</Submit>
        </ActionForm>
      </div>
    ) : null;

  return (
    <div>
      <PageHead title="Trials" sub={`An approved cut goes out as an Instagram trial reel, shown to non-followers first — or as a normal reel for collab cuts and accounts under 1,000 followers (those are compared only with the speaker's other normal reels). Numbers are read at 3h, 6h and 12h; at ${hours}h it's compared with that speaker's median. Winners go everywhere within ${winHours}h.`} />
      {!rows.length ? <Empty title="No trials yet">Approve a cut on the Edits page to post the first one.</Empty> : null}

      {toDecide.length ? (
        <Section title={`Your call (${toDecide.length})`}>
          <div className="space-y-3">{toDecide.map((t) => <Row key={t.id} t={t}><div className="mt-2"><Window since={t.verdict_at} hours={winHours} verb="Decide" /></div><VerdictButtons t={t} /></Row>)}</div>
        </Section>
      ) : null}

      {[["Winners to send", winners], ["Winners sent", sentWinners]].map(([title, list]) => (list as any[]).length ? (
        <Section key={title as string} title={`${title} (${(list as any[]).length})`}>
          <div className="space-y-3">
            {(list as any[]).map((t) => {
              const done = sentFor(t.edit_id);
              const left = PLATFORMS.filter((p) => !done.some((d) => d.platform === p && d.status !== "error" && d.status !== "skipped"));
              return (
                <Row key={t.id} t={t}>
                  {!done.length ? <div className="mt-2"><Window since={t.verdict_at} hours={winHours} verb="Send everywhere" /></div> : null}
                  <Link href="/growth#boosts" className="mt-2 inline-block text-xs text-muted hover:text-accent">Boosting it? Log the spend on Growth →</Link>
                  {done.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {done.map((d, i) => <span key={i}>{PLATFORM_LABEL[d.platform as keyof typeof PLATFORM_LABEL]} <Status s={d.status} /></span>)}
                    </div>
                  ) : null}
                  {approver && left.length ? (
                    <ActionForm action={sendWinner} className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                      <input type="hidden" name="editId" value={t.edit_id} />
                      {left.map((p) => {
                        const ok = ready(t.speaker_id, p);
                        return (
                          <label key={p} className={`flex items-center gap-1.5 ${ok ? "" : "text-muted"}`}>
                            <input type="checkbox" name="platform" value={p} defaultChecked={ok} disabled={!ok} /> {PLATFORM_LABEL[p]}
                            {p === "instagram" ? <span className="text-xs text-muted">(graduate)</span> : p === "youtube" && !env.youtubeUploadEnabled() ? <span className="text-xs text-muted">(by hand)</span> : !ok ? <span className="text-xs">(not connected)</span> : null}
                          </label>
                        );
                      })}
                      <Submit>Send everywhere</Submit>
                      <details className="w-full text-xs text-muted">
                        <summary className="cursor-pointer select-none">See exactly what goes out on each platform</summary>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {left.filter((p) => p !== "instagram").map((p) => {
                            const s = { hook: t.hook, caption: t.script_caption, hashtags: t.hashtags, linkedin_text: t.linkedin_text, caption_disclaimer: t.caption_disclaimer, screen_disclaimer: t.screen_disclaimer };
                            const withLink = p === "youtube" || linkPlatforms().includes(p);
                            return (
                              <div key={p} className="rounded-lg border border-line p-2">
                                <div className="mb-1 font-medium text-ink">{PLATFORM_LABEL[p]}{withLink ? "" : " · no link (Settings)"}</div>
                                <div className="whitespace-pre-wrap">{captionFor(p, s, withLink ? "https://…/r/(tracking link)" : null)}</div>
                              </div>
                            );
                          })}
                        </div>
                        {json<any>(t.compliance, {}).status !== "ok" ? <p className="mt-2 text-amber-700">The script has rule notes — open it before sending.</p> : null}
                      </details>
                    </ActionForm>
                  ) : null}
                </Row>
              );
            })}
          </div>
        </Section>
      ) : null)}

      {live.length ? (
        <Section title="Live now">
          <div className="space-y-3">{live.map((t) => <Row key={t.id} t={t}>{approver && t.status === "live" ? <VerdictButtons t={t} /> : null}</Row>)}</div>
        </Section>
      ) : null}

      {errors.length ? (
        <Section title="Didn't post">
          <div className="space-y-3">
            {errors.map((t) => (
              <Row key={t.id} t={t}>
                {approver ? (
                  <ActionForm action={retryTrial} className="mt-3">
                    <input type="hidden" name="trialId" value={t.id} />
                    <Submit className="btn-ghost">Try again</Submit>
                  </ActionForm>
                ) : null}
              </Row>
            ))}
          </div>
        </Section>
      ) : null}

      {others.length ? (
        <Section title="Not winners (recent)">
          <div className="space-y-3">
            {others.map((t) => {
              const hooks = (json<DoctorNote | null>(t.doctor, null)?.better_hooks || []).filter((h) => h !== t.hook);
              return (
                <Row key={t.id} t={t}>
                  {approver ? (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer select-none text-xs text-accent">Re-test with a new hook (same video, new on-screen hook)</summary>
                      <ActionForm action={retestHook} className="mt-2 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="editId" value={t.edit_id} />
                        <input name="hook" list={`hooks-${t.id}`} className="input w-96 max-w-full" placeholder="Pick a Hook Doctor hook or type one" required />
                        <datalist id={`hooks-${t.id}`}>
                          {hooks.map((h, i) => <option key={i} value={h} />)}
                        </datalist>
                        <Submit className="btn-ghost">Make the new cut</Submit>
                      </ActionForm>
                      <p className="mt-1 text-xs text-muted">The spoken words stay the same; only the hook text on screen changes. You approve the new cut before it posts as a new trial.</p>
                    </details>
                  ) : null}
                </Row>
              );
            })}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
