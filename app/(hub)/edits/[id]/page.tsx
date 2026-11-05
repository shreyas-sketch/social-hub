import Link from "next/link";
import { notFound } from "next/navigation";
import { one, raw, json } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { accountFor } from "@/lib/accounts";
import { trialMode, TRIAL_MIN_FOLLOWERS } from "@/lib/trials";
import { CAPTION_STYLES } from "@/lib/edit/captions";
import { DEFAULT_EDIT, type EditSettings } from "@/lib/edit/ffmpeg";
import { finalCaption } from "@/lib/compliance";
import { PageHead, Status, Section, ago } from "@/components/ui";
import { ComplianceNotes } from "@/components/ScriptCard";
import { cutCheck } from "@/lib/edits";
import { env } from "@/lib/config";
import { ActionForm, Submit } from "@/components/forms";
import { reEdit, fixWords, approveCut, rejectCut, makeVariants, postVariants, setCollaborators } from "@/app/actions";
import { collaboratorsOf } from "@/lib/trials";
import type { DoctorNote } from "@/lib/agents";

const file = (p: string) => `/api/files?p=${encodeURIComponent(p)}`;

export default function EditPage({ params }: { params: { id: string } }) {
  const u = requireUser();
  const e = one<any>(
    `SELECT e.*, s.title, s.hook, s.caption, s.hashtags, s.speaker_id, s.id AS sid, s.doctor, s.source, sp.name AS speaker, sp.caption_disclaimer, sp.niche, v.raw_name, v.raw_path, v.duration AS raw_duration, v.clip_start
     FROM edits e JOIN scripts s ON s.id = e.script_id JOIN speakers sp ON sp.id = s.speaker_id JOIN videos v ON v.id = e.video_id WHERE e.id = ?`,
    [Number(params.id)],
  );
  if (!e) notFound();
  const st = json<EditSettings>(e.settings, DEFAULT_EDIT);
  const words = json<{ w: string }[]>(e.transcript, []);
  const warnings = json<string[]>(e.warnings, []);
  const versions = raw<any>(`SELECT id, version, status, created_at FROM edits WHERE video_id = ? ORDER BY version DESC`, [e.video_id]);
  const trial = one<any>(`SELECT * FROM trials WHERE edit_id = ? ORDER BY id DESC LIMIT 1`, [e.id]);
  const ig = accountFor(e.speaker_id, "instagram");
  const igReady = ig?.status === "connected";
  const mode = ig ? trialMode(ig.id) : "trial";
  const latest = versions[0]?.id === e.id;
  // Hook test: this cut plus the variants made from it (same video, a different hook on screen each).
  const baseId = e.variant_of || e.id;
  const group = raw<any>(`SELECT id, version, status, settings FROM edits WHERE id = ? OR variant_of = ? ORDER BY id`, [baseId, baseId]);
  const groupTrials = raw<any>(`SELECT edit_id, status, views, verdict FROM trials WHERE status <> 'replaced' AND edit_id IN (${group.map(() => "?").join(",") || "0"})`, group.map((g) => g.id));
  const hookOf = (g: any) => json<any>(g.settings, {}).hookText || e.hook;
  const betterHooks = (json<DoctorNote | null>(e.doctor, null)?.better_hooks || []).filter((h) => h && h !== e.hook);
  const collabs = collaboratorsOf(e.settings);
  // The same rules check as the script, on what the take actually says and the hook on screen.
  const said = words.length ? cutCheck(e, e.niche) : null;
  // A take with sound but no transcript can't be checked against the rules, so it can't go out.
  const silent = warnings.some((w) => /has no sound/i.test(w));
  const unchecked = !words.length && !silent && env.transcribeEngine() !== "none" && ["ready", "approved"].includes(e.status);
  const saysBlocked = said?.status === "block" || unchecked;
  // A first try that failed before reaching Instagram can be approved again (it may now go out as a normal reel).
  const canReapprove = !trial || (trial.status === "error" && !trial.container_id);
  const asNormal = collabs.length > 0 || mode === "regular";

  return (
    <div>
      <PageHead
        title={e.title}
        sub={<>{e.speaker} · v{e.version} · <Status s={e.status} /> · {ago(e.updated_at)}</>}
        right={<Link href={`/scripts/${e.sid}`} className="btn-ghost">Script</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="min-w-0">
          <div className="card overflow-hidden">
            {(e.status === "ready" || e.status === "approved" || e.status === "rejected") && e.output_path ? (
              <video src={file(e.output_path)} poster={e.thumb_path ? file(e.thumb_path) : undefined} controls playsInline className="aspect-[9/16] w-full bg-black" />
            ) : e.status === "error" ? (
              <div className="grid aspect-[9/16] place-items-center p-6 text-center text-sm text-red-600">The cut failed:<br />{e.error}</div>
            ) : (
              <div className="grid aspect-[9/16] place-items-center text-sm text-muted">Cutting… refresh in a minute.</div>
            )}
          </div>
          {e.output_path && ["ready", "approved", "rejected"].includes(e.status) ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <a className="link" href={file(e.output_path) + "&download=1"}>Download reel</a>
              <span className="text-muted">·</span>
              {e.source === "clip" ? <Link className="link" href={`/scripts/${e.sid}`}>From a long session</Link> : <a className="link" href={file(e.raw_path) + "&download=1"}>Download raw</a>}
              {e.duration ? <span className="ml-auto text-muted">{Math.round(e.duration)}s (raw {Math.round(e.raw_duration || 0)}s)</span> : null}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          {e.status === "rejected" ? (
            <div className="rounded-xl2 border border-line bg-white p-4 text-sm">
              Marked not usable{e.notes ? `: ${e.notes}` : "."} Re-cut it below, or upload a new take from the Shoot page.
            </div>
          ) : null}
          {st.hookText ? (
            <div className="rounded-xl2 border border-accentSoft bg-accentSoft p-4 text-sm">Re-test cut — on-screen hook: <b>{st.hookText}</b></div>
          ) : null}
          {warnings.length ? (
            <div className="rounded-xl2 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          ) : null}

          {!words.length && env.transcribeEngine() === "none" && ["ready", "approved"].includes(e.status) ? (
            <div className="rounded-xl2 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Transcription is switched off for this hub, so what the take says hasn&apos;t been checked against the rules. Listen to it before approving.</div>
          ) : null}
          {unchecked ? (
            <div className="rounded-xl2 border border-red-200 bg-red-50 p-4 text-sm text-red-800">The words in this take couldn&apos;t be checked against the rules (no transcript), so it can&apos;t be approved. Re-cut it; if that doesn&apos;t help, check the sound.</div>
          ) : null}
          {said && said.issues.length ? (
            <div className="card p-4 text-sm">
              <p className="font-medium">What this cut says and shows, against the rules</p>
              <p className="text-xs text-muted">Checked on the words heard in the take and the hook on screen.{saysBlocked ? " It can't be approved until those words are gone — re-shoot that part, or fix the words if the caption misheard them." : ""}</p>
              <ComplianceNotes compliance={JSON.stringify(said)} />
            </div>
          ) : null}

          {trial ? (
            <div className="card p-4 text-sm">
              {trial.mode === "regular" ? "Reel" : "Trial reel"}: <Status s={trial.status} /> {trial.permalink ? <a className="link ml-2" href={trial.permalink} target="_blank" rel="noreferrer">open on Instagram</a> : null}
              <Link className="link ml-2" href="/trials">see numbers</Link>
              {trial.error ? <p className="mt-1 text-red-600">{trial.error}</p> : null}
            </div>
          ) : null}
          {canReapprove && ["ready", "approved"].includes(e.status) && canApprove(u) ? (
            <Section title="Approve">
              <div className="card space-y-3 p-4">
                {collabs.length ? (
                  <p className="text-sm text-muted">This cut has collaborators ({collabs.map((c) => "@" + c).join(", ")}), so approving posts it as a <b>normal collab reel</b> — Instagram doesn&apos;t allow collaborators on trial reels. It&apos;s judged against this speaker&apos;s other normal reels.</p>
                ) : mode === "trial" ? (
                  <p className="text-sm text-muted">Approving posts this cut as an Instagram <b>trial reel</b> — shown to non-followers first. Numbers are read at 3h, 6h and 12h; the verdict comes at 24h.</p>
                ) : (
                  <p className="text-sm text-muted">Instagram only allows trial reels from {TRIAL_MIN_FOLLOWERS.toLocaleString("en-IN")} followers, so approving posts this as a <b>normal reel</b> (it shows on the grid). It&apos;s judged against this speaker&apos;s other normal reels.</p>
                )}
                {!igReady ? <p className="text-sm text-red-600">Connect {e.speaker}&apos;s Instagram first (Accounts page).</p> : null}
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={approveCut}>
                    <input type="hidden" name="editId" value={e.id} />
                    <Submit className="btn-ok" disabled={!igReady || saysBlocked}>{asNormal ? "Approve and post as a normal reel" : "Approve and post as trial"}</Submit>
                  </ActionForm>
                  <ActionForm action={rejectCut} className="flex gap-2">
                    <input type="hidden" name="editId" value={e.id} />
                    <input name="note" className="input h-8 w-48 py-1" placeholder="what's wrong (optional)" />
                    <Submit className="btn-ghost">Not usable</Submit>
                  </ActionForm>
                </div>
              </div>
            </Section>
          ) : null}

          {e.variant_of ? (
            <div className="rounded-xl2 border border-accentSoft bg-accentSoft p-4 text-sm">
              Hook test — a variant of <Link className="link" href={`/edits/${e.variant_of}`}>the first cut</Link>. Post the whole test from there.
            </div>
          ) : null}

          {canApprove(u) && !e.variant_of && ["ready", "approved"].includes(e.status) && mode === "trial" && !collabs.length ? (
            <Section title="Test 2–3 hooks on this idea">
              <div className="card space-y-3 p-4 text-sm">
                <p className="text-xs text-muted">Same video, a different hook on screen for the first 3 seconds. Each goes out as its own trial reel, so you see which opening works. Instagram spots near-copies, so make each hook clearly different. Trials per account a day are capped in Settings.</p>
                {group.length > 1 ? (
                  <div className="divide-y divide-line rounded-lg border border-line">
                    {group.map((g) => {
                      const t = groupTrials.find((x) => x.edit_id === g.id);
                      return (
                        <Link key={g.id} href={`/edits/${g.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-canvas">
                          <span className="min-w-0 flex-1 truncate">{hookOf(g)}</span>
                          {t ? <span className="text-xs tabular-nums text-muted">{t.views != null ? `${t.views.toLocaleString("en-IN")} views` : t.status}</span> : null}
                          {t?.verdict && t.verdict !== "pending" ? <Status s={t.verdict} /> : <Status s={g.status} />}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
                {group.length < 3 ? (
                  <ActionForm action={makeVariants} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <input type="hidden" name="editId" value={e.id} />
                    <input name="hook1" list={`vh-${e.id}`} className="input" placeholder="Another hook" required />
                    {group.length < 2 ? <input name="hook2" list={`vh-${e.id}`} className="input" placeholder="And another (optional)" /> : <span />}
                    <datalist id={`vh-${e.id}`}>{betterHooks.map((h, i) => <option key={i} value={h} />)}</datalist>
                    <Submit className="btn-ghost">Make the variants</Submit>
                  </ActionForm>
                ) : null}
                {group.length > 1 && group.some((g) => g.status === "ready" && !groupTrials.some((t) => t.edit_id === g.id && !["error", "replaced"].includes(t.status))) ? (
                  <ActionForm action={postVariants}>
                    <input type="hidden" name="editId" value={baseId} />
                    <Submit className="btn-ok" disabled={!igReady || saysBlocked || group.some((g) => ["queued", "running"].includes(g.status))}>Approve and post all as trials</Submit>
                  </ActionForm>
                ) : null}
              </div>
            </Section>
          ) : null}

          {canApprove(u) && !trial && ["ready"].includes(e.status) ? (
            <Section title="Collab post (optional)">
              <ActionForm action={setCollaborators} className="card flex flex-wrap items-center gap-2 p-4 text-sm">
                <input type="hidden" name="editId" value={e.id} />
                <input name="collaborators" className="input w-80 max-w-full" defaultValue={collabs.map((c) => "@" + c).join(" ")} placeholder="@username @another (up to 3)" />
                <Submit className="btn-ghost">Save</Submit>
                <p className="w-full text-xs text-muted">Each gets an invite to show the reel on their profile too. A collab reel posts as a normal reel, not a trial.</p>
              </ActionForm>
            </Section>
          ) : null}

          {latest && (e.status === "ready" || e.status === "error" || e.status === "rejected") ? (
            <>
              <Section title="Change the cut">
                <ActionForm action={reEdit} className="card grid gap-3 p-4 sm:grid-cols-4">
                  <input type="hidden" name="editId" value={e.id} />
                  <div>
                    <label className="label">Captions</label>
                    <select name="captionStyle" className="input" defaultValue={st.captionStyle}>
                      {CAPTION_STYLES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Landscape footage</label>
                    <select name="frame" className="input" defaultValue={st.frame}>
                      <option value="crop">Crop to the centre</option>
                      <option value="fit_blur">Fit, blurred background</option>
                    </select>
                  </div>
                  <label className="flex items-end gap-2 pb-2 text-sm">
                    <input type="checkbox" name="cutSilence" defaultChecked={st.cutSilence} /> Cut pauses
                  </label>
                  <div className="flex items-end"><Submit>Re-cut</Submit></div>
                </ActionForm>
              </Section>
              {words.length ? (
                <Section title="Fix caption words">
                  <ActionForm action={fixWords} className="card space-y-2 p-4">
                    <input type="hidden" name="editId" value={e.id} />
                    <p className="text-xs text-muted">Correct misheard words (names, tickers, Hindi words). Keep the same number of words to keep the timing exact. Taking out words the rules flag needs an owner or admin — the audio still says them.</p>
                    <textarea name="text" rows={6} className="input font-mono text-xs" defaultValue={words.map((w) => w.w).join(" ")} />
                    <Submit>Save words and re-cut</Submit>
                  </ActionForm>
                </Section>
              ) : null}
            </>
          ) : null}

          <Section title="Instagram caption that goes out" right={<Link href={`/scripts/${e.sid}`} className="link text-xs">edit</Link>}>
            <div className="card whitespace-pre-wrap p-4 text-sm">{finalCaption(e.caption || "", e.hashtags, e.caption_disclaimer, null)}</div>
          </Section>

          {versions.length > 1 ? (
            <Section title="Versions">
              <div className="card divide-y divide-line text-sm">
                {versions.map((v) => (
                  <Link key={v.id} href={`/edits/${v.id}`} className={`flex items-center justify-between px-4 py-2 hover:bg-canvas ${v.id === e.id ? "font-medium" : ""}`}>
                    <span>v{v.version} · {ago(v.created_at)}</span>
                    <Status s={v.status} />
                  </Link>
                ))}
              </div>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
