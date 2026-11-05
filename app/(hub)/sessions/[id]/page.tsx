import Link from "next/link";
import { notFound } from "next/navigation";
import { one, raw, json } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { env } from "@/lib/config";
import { accountFor, youtubeCanUpload } from "@/lib/accounts";
import { SESSION_KINDS, sessionWords, flagsInRange, longformDescription, type FlagRange } from "@/lib/sessions";
import { stamp, chapterLines, type Chapter } from "@/lib/edit/longform";
import { speaker as getSpeaker } from "@/lib/speakers";
import { PageHead, Section, Empty, Status, Badge, ago } from "@/components/ui";
import { ActionForm, Submit, CopyButton } from "@/components/forms";
import { Uploader } from "@/components/Uploader";
import { ScriptCard, ComplianceNotes } from "@/components/ScriptCard";
import { longformSeen } from "@/lib/seen";
import { retrySession, moreClips, saveLongformAction, cutLongformAction, approveLongformAction, longformUploadedAction, testWinnerAction } from "@/app/actions";

const file = (p: string) => `/api/files?p=${encodeURIComponent(p)}`;

export default function SessionPage({ params }: { params: { id: string } }) {
  const u = requireUser();
  const approver = canApprove(u);
  const se = one<any>(`SELECT se.*, sp.name AS speaker FROM sessions se JOIN speakers sp ON sp.id = se.speaker_id WHERE se.id = ?`, [Number(params.id)]);
  if (!se) notFound();
  const sp = getSpeaker(se.speaker_id)!;
  const clips = raw<any>(
    `SELECT s.*, ? AS speaker, (SELECT MAX(e.id) FROM edits e WHERE e.script_id = s.id) AS edit_id FROM scripts s WHERE s.session_id = ? ORDER BY s.clip_start`,
    [se.speaker, se.id],
  );
  const lf = one<any>(`SELECT * FROM longforms WHERE session_id = ? ORDER BY id DESC LIMIT 1`, [se.id]);
  const picks = json<any>(se.picks, null);
  const laneName = (key: string) => sp.lanes.find((l) => l.key === key)?.name;
  const toReview = clips.filter((c) => c.status === "proposed");
  const rest = clips.filter((c) => c.status !== "proposed");
  const flags = lf ? flagsInRange(sessionWords(se), sp.niche, lf.trim_start, lf.trim_end) : [];

  return (
    <div>
      <PageHead
        title={se.title}
        sub={<>{se.speaker} · {SESSION_KINDS[se.kind] || se.kind}{se.guest ? ` with ${se.guest}` : ""}{se.duration ? ` · ${Math.round(se.duration / 60)} min` : ""} · {ago(se.created_at)}</>}
        right={<Link href="/sessions" className="btn-ghost">All sessions</Link>}
      />

      {!se.raw_path || se.status === "waiting" ? (
        <Section title="Upload the recording">
          <div className="card p-4">
            <Uploader sessionId={se.id} label="Upload the recording" />
            <p className="mt-2 text-xs text-muted">The whole session in one file, up to 20 GB. It uploads in pieces and picks up where it left off if the connection drops.</p>
          </div>
        </Section>
      ) : null}

      {se.status === "transcribing" || se.status === "picking" ? (
        <div className="card mb-6 p-4 text-sm">
          <Badge tone="amber">{se.status === "transcribing" ? "writing the transcript" : "picking clips"}</Badge>
          <span className="ml-2 text-muted">{se.status === "transcribing" ? "For a 90-minute recording this takes a while on the server. Refresh later." : "Claude is reading the transcript. Refresh in a minute or two."}</span>
        </div>
      ) : null}

      {se.status === "error" ? (
        <div className="mb-6 rounded-xl2 border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {se.error}
          {se.raw_path ? (
            <ActionForm action={retrySession} className="mt-2">
              <input type="hidden" name="id" value={se.id} />
              <Submit className="btn-ghost">Try again</Submit>
            </ActionForm>
          ) : null}
        </div>
      ) : null}

      {se.raw_path ? (
        <Section
          title={`Clips (${clips.length})`}
          right={
            approver && se.words_path && se.status === "ready" ? (
              <ActionForm action={moreClips}>
                <input type="hidden" name="id" value={se.id} />
                <Submit className="btn-ghost">Find more clips</Submit>
              </ActionForm>
            ) : null
          }
        >
          {picks?.skipped?.length ? <p className="mb-3 text-xs text-muted">Left out: {picks.skipped.join(", ")}.</p> : null}
          {clips.length ? (
            <div className="space-y-6">
              {toReview.length ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {toReview.map((c) => (
                    <div key={c.id}>
                      <video src={`${file(se.raw_path)}#t=${c.clip_start},${c.clip_end}`} preload="none" controls className="mb-2 aspect-video w-full rounded-xl2 bg-black" />
                      <ScriptCard s={c} canApprove={approver} laneName={laneName(c.lane)} />
                    </div>
                  ))}
                </div>
              ) : null}
              {rest.length ? (
                <div className="card divide-y divide-line text-sm">
                  {rest.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <span className="tabular-nums text-xs text-muted">{stamp(c.clip_start)}–{stamp(c.clip_end)}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                      <Status s={c.status} />
                      {c.edit_id ? <Link href={`/edits/${c.edit_id}`} className="link text-xs">the cut</Link> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : se.status === "ready" ? (
            <Empty title="No clips found">Press “Find more clips”, or check the recording has clear speech.</Empty>
          ) : (
            <Empty title="Clips come after the transcript" />
          )}
          <p className="mt-3 text-xs text-muted">Approving a clip starts its cut straight away — no shoot needed. The spoken words can't be changed, so a clip whose words break a rule can't be approved.</p>
        </Section>
      ) : null}

      {lf ? <LongForm lf={lf} se={se} approver={approver} flags={flags} /> : null}
    </div>
  );
}

function LongForm({ lf, se, approver, flags }: { lf: any; se: any; approver: boolean; flags: FlagRange[] }) {
  const titles = json<string[]>(lf.titles, []);
  const chapters = json<Chapter[]>(lf.chapters, []);
  const outChapters = json<Chapter[]>(lf.out_chapters, []);
  const thumbTexts = json<string[]>(lf.thumb_texts, []);
  const thumbs = json<string[]>(lf.thumbs, []);
  const warnings = json<string[]>(lf.warnings, []);
  const cutting = ["queued", "cutting"].includes(lf.status);
  // Locked once it's going to YouTube, while it's being cut, and (for the team) once it's approved.
  const locked = ["uploading", "uploaded"].includes(lf.status) || cutting || (!!lf.approved_by && !approver);
  const keep = json<string[]>(lf.keep_flags, []);
  const removed = json<FlagRange[]>(lf.removed, []);
  const leftover = json<FlagRange[]>(lf.leftover, []);
  const cutWith = new Set(removed.map((r) => r.key));
  // Parts found only once the cut joined two halves together show up after the cut.
  const all = [...flags, ...removed.filter((r) => !flags.some((f) => f.key === r.key)).map((r) => ({ ...r, joined: true }))].sort((a, b) => a.s - b.s) as (FlagRange & { joined?: boolean })[];
  const willCut = (f: FlagRange & { joined?: boolean }) => f.joined || f.level === "block" || (!f.soft && !keep.includes(f.key));

  return (
    <Section title="YouTube long video" right={<Status s={lf.status} />}>
      <div className="space-y-4">
        {lf.error ? <div className="rounded-xl2 border border-red-200 bg-red-50 p-3 text-sm text-red-800">{lf.error}</div> : null}
        {warnings.length ? (
          <div className="rounded-xl2 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {warnings.map((w, i) => <p key={i}>{w}</p>)}
          </div>
        ) : null}
        {all.length ? (
          <div className="card p-3 text-sm">
            <div className="font-medium">Cut out of the video because the SEBI/ASCI rules flag them ({all.filter(willCut).length} of {all.length})</div>
            <p className="mt-1 text-xs text-muted">The sentence that says it comes out, so nothing is left half-said. Red = a blocking rule, always cut. Amber = a “check” rule, cut unless an owner or admin keeps it. Grey = a wording note only, left in. A warning like “there are no guaranteed returns” isn&apos;t flagged.</p>
            <ul className="mt-2 space-y-1">
              {all.map((f) => {
                const cut = willCut(f);
                return (
                  <li key={f.key} className={`rounded-lg px-3 py-1.5 text-xs ${f.level === "block" ? "bg-red-50 text-red-800" : f.soft ? "bg-canvas text-muted" : "bg-amber-50 text-amber-900"}`}>
                    <a className="font-semibold underline" href={`${file(se.raw_path)}#t=${Math.max(0, f.s - 2)}`} target="_blank" rel="noreferrer">{stamp(f.s)}–{stamp(f.e)}</a>{" "}
                    <b>{cut ? "cut" : f.soft ? "left in (wording note)" : "kept"}</b>
                    {f.joined ? <span> (found after the cut joined two parts)</span> : null}
                    {!f.joined && lf.output_path && cutWith.has(f.key) !== cut ? <span className="text-muted"> (cut it again to apply)</span> : null}
                    {" · "}{f.issues.map((i) => `“${i.match}” — ${i.rule}`).join("; ")}
                    <div className="mt-0.5 italic opacity-80">“{f.text}”</div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted">I&apos;m not a lawyer — ask your compliance person when unsure.</p>
          </div>
        ) : null}
        {leftover.length ? (
          <div className="rounded-xl2 border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            Still flagged in the finished video: {leftover.map((l) => `${stamp(l.s)} “${l.issues[0]?.match}”`).join(", ")}. Cut it again; if it stays, trim the start or end.
          </div>
        ) : null}

        <ActionForm action={saveLongformAction} className="card grid gap-3 p-4">
          <input type="hidden" name="id" value={lf.id} />
          <div>
            <label className="label">Title (YouTube's Test & Compare can try up to 3 — the options are below)</label>
            <input name="title" className="input" defaultValue={lf.title || ""} list={`titles-${lf.id}`} maxLength={100} disabled={locked} required />
            <datalist id={`titles-${lf.id}`}>{titles.map((t, i) => <option key={i} value={t} />)}</datalist>
            {titles.length ? <ul className="mt-1 list-disc pl-5 text-xs text-muted">{titles.map((t, i) => <li key={i}>{t}</li>)}</ul> : null}
          </div>
          <div>
            <label className="label">Description (the hub adds the chapters, the tracking link and the disclaimer)</label>
            <textarea name="description" rows={5} className="input" defaultValue={lf.description || ""} disabled={locked} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">Chapters — times in the recording, one per line (m:ss Title)</label>
              <textarea name="chapters" rows={8} className="input font-mono text-xs" defaultValue={chapterLines(chapters)} disabled={locked} />
              <p className="mt-1 text-[11px] text-muted">The hub moves them onto the finished video's timeline after the pauses come out. YouTube needs at least 3, each 10 seconds or longer.</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Tags (comma-separated)</label>
                <textarea name="tags" rows={3} className="input text-xs" defaultValue={lf.tags || ""} disabled={locked} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2].map((k) => (
                  <div key={k}>
                    <label className="label">Thumbnail {k + 1}</label>
                    <input name={`thumb${k + 1}`} className="input" defaultValue={thumbTexts[k] || ""} maxLength={40} disabled={locked} />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Start at (m:ss)</label>
                  <input name="trim_start" className="input" defaultValue={lf.trim_start != null ? stamp(lf.trim_start) : ""} placeholder="0:00" disabled={locked} />
                </div>
                <div>
                  <label className="label">End at (m:ss)</label>
                  <input name="trim_end" className="input" defaultValue={lf.trim_end != null ? stamp(lf.trim_end) : ""} placeholder="the end" disabled={locked} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="cut_silence" defaultChecked={!!lf.cut_silence} disabled={locked} /> Cut pauses longer than a second
              </label>
              {approver && flags.some((f) => f.level === "warn" && !f.soft) ? (
                <div className="rounded-lg border border-amber-200 p-2 text-xs">
                  <input type="hidden" name="keep_shown" value="1" />
                  <div className="mb-1 font-medium">Keep these “check” parts in the video (blocking parts are always cut)</div>
                  {flags.filter((f) => f.level === "warn" && !f.soft).map((f) => (
                    <label key={f.key} className="flex items-start gap-2 py-0.5">
                      <input type="checkbox" name="keep" value={f.key} defaultChecked={keep.includes(f.key)} disabled={locked} className="mt-0.5" />
                      <span>{stamp(f.s)} — {f.issues.map((i) => `“${i.match}”`).join(", ")}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <ComplianceNotes compliance={lf.compliance} />
          {!locked ? <div><Submit>Save</Submit>{lf.approved_by ? <span className="ml-3 text-xs text-muted">Saving a change means it needs approving again.</span> : null}</div> : cutting ? <p className="text-xs text-muted">Locked while it&apos;s being cut.</p> : null}
        </ActionForm>

        {!["uploading", "uploaded"].includes(lf.status) && (!lf.approved_by || approver) ? (
          <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
            {cutting ? (
              <span className="text-muted">Cutting… a 90-minute recording can take an hour or more. Refresh later.</span>
            ) : (
              <>
                <ActionForm action={cutLongformAction}>
                  <input type="hidden" name="id" value={lf.id} />
                  <Submit className={lf.output_path ? "btn-ghost" : "btn-primary"}>{lf.output_path ? "Cut it again" : "Cut the long video"}</Submit>
                </ActionForm>
                <span className="text-xs text-muted">16:9, pauses out, HDR converted, sound levelled, plus a captions file and 3 thumbnails.</span>
              </>
            )}
          </div>
        ) : null}

        {lf.output_path && !cutting ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div>
              <video src={file(lf.output_path)} controls preload="metadata" className="aspect-video w-full rounded-xl2 bg-black" />
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                <a className="link" href={file(lf.output_path) + "&download=1"}>Download the video</a>
                {lf.srt_path ? <a className="link" href={file(lf.srt_path) + "&download=1"}>Download captions (.srt)</a> : null}
                {lf.duration ? <span className="text-muted">{Math.round(lf.duration / 60)} min</span> : null}
              </div>
            </div>
            <div className="space-y-2">
              {thumbs.map((t, i) => (
                <a key={i} href={file(t) + "&download=1"} className="block">
                  <img src={file(t)} alt={`Thumbnail ${i + 1}`} className="w-full rounded-lg border border-line" />
                </a>
              ))}
              <p className="text-[11px] text-muted">Click a thumbnail to download it. Upload all three to YouTube's Test & Compare.</p>
            </div>
          </div>
        ) : null}

        {outChapters.length ? (
          <div className="card p-4 text-xs">
            <div className="mb-1 font-medium text-ink">Chapters on the finished video</div>
            <pre className="whitespace-pre-wrap font-mono">{chapterLines(outChapters)}</pre>
          </div>
        ) : null}

        {lf.status === "ready" && approver ? (
          <ActionForm action={approveLongformAction} className="card flex flex-wrap items-center gap-3 p-4 text-sm">
            <input type="hidden" name="id" value={lf.id} />
            <input type="hidden" name="seen" value={longformSeen(lf)} />
            <Submit className="btn-ok" disabled={leftover.length > 0}>Approve for YouTube</Submit>
            <span className="text-xs text-muted">{youtubeCanUpload(accountFor(lf.speaker_id, "youtube")) ? "Uploads to the speaker's YouTube channel through the API." : env.youtubeUploadEnabled() ? "This channel isn't connected with upload permission (connect it again on Accounts), so the team uploads it in YouTube Studio — everything needed shows here after approval." : "Until Google audits the app, the team uploads it in YouTube Studio — everything needed shows here after approval."}</span>
          </ActionForm>
        ) : null}

        {["manual_todo", "uploaded", "error"].includes(lf.status) && lf.approved_by ? (
          <div className="card space-y-3 p-4 text-sm">
            <div className="font-medium">Upload in YouTube Studio</div>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
              <li>Download the video, the captions file and the 3 thumbnails above.</li>
              <li>Upload the video. Paste the title and description below.</li>
              <li>Add the captions file (Subtitles → Upload file → With timing).</li>
              <li>Thumbnail → Test & Compare → add all three thumbnails (and up to 3 titles).</li>
              <li>Publish, then paste the video&apos;s link here.</li>
            </ol>
            <div className="flex items-center gap-2"><b className="min-w-0 flex-1 truncate">{lf.title}</b><CopyButton text={lf.title || ""} label="Copy title" /></div>
            <details>
              <summary className="cursor-pointer select-none text-xs text-accent">Description that goes up</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-canvas p-3 text-xs">{longformDescription(lf.id)}</pre>
            </details>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={longformDescription(lf.id)} label="Copy description" />
              <CopyButton text={lf.tags || ""} label="Copy tags" />
            </div>
            {lf.status !== "uploaded" ? (
              <ActionForm action={longformUploadedAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="id" value={lf.id} />
                <input name="url" className="input w-96 max-w-full" placeholder="https://www.youtube.com/watch?v=…" required />
                <Submit>Uploaded</Submit>
              </ActionForm>
            ) : null}
          </div>
        ) : null}

        {lf.status === "uploaded" ? (
          <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
            <span className="min-w-0 break-all">On YouTube: <a className="link" href={lf.permalink} target="_blank" rel="noreferrer">{lf.permalink}</a></span>
            <ActionForm action={testWinnerAction} className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
              <input type="hidden" name="id" value={lf.id} />
              <select name="title" className="input h-8 w-full py-1 sm:w-72" defaultValue={lf.test_winner || ""}>
                <option value="">Test & Compare winner…</option>
                {[...new Set([lf.title, ...titles].filter(Boolean))].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <Submit className="btn-ghost">Log it</Submit>
            </ActionForm>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
