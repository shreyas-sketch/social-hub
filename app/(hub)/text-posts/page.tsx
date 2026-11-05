import Link from "next/link";
import { raw, json } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { setting } from "@/lib/config";
import { speakers, speaker as getSpeaker } from "@/lib/speakers";
import { xLength } from "@/lib/publish";
import { textPerDay } from "@/lib/textposts";
import { PageHead, Section, Empty, Badge, Status, SpeakerTabs, ago, fmt } from "@/components/ui";
import { ActionForm, Submit, CopyButton } from "@/components/forms";
import { ComplianceNotes } from "@/components/ScriptCard";
import { textPostSeen } from "@/lib/seen";
import { decideTextAction, saveTextAction, writeTextNow, textNumbersAction, retryTextAction } from "@/app/actions";

const TABS = [
  { key: "proposed", label: "To review" },
  { key: "approved", label: "Approved" },
  { key: "posted", label: "Posted" },
  { key: "rejected", label: "Rejected" },
];

export default function TextPosts({ searchParams }: { searchParams: { speaker?: string; status?: string } }) {
  const u = requireUser();
  const approver = canApprove(u);
  const sp = speakers();
  const active = searchParams.speaker ? getSpeaker(searchParams.speaker) : undefined;
  const status = TABS.find((t) => t.key === searchParams.status)?.key || "proposed";
  const where = status === "approved" ? `tp.status IN ('approved','posting','error')` : `tp.status = @status`;
  const rows = raw<any>(
    `SELECT tp.*, sp.name AS speaker, s.hook AS from_hook FROM text_posts tp JOIN speakers sp ON sp.id = tp.speaker_id LEFT JOIN scripts s ON s.id = tp.from_script_id
     WHERE ${where} ${active ? "AND tp.speaker_id = @sid" : ""} ORDER BY tp.id DESC LIMIT 150`,
    { status, sid: active?.id },
  );
  const hour = setting("text_post_hour_ist");

  return (
    <div>
      <PageHead
        title="Text posts"
        sub={`LinkedIn and X posts written for the platform, not the reel cross-posted. Written every morning (LinkedIn on weekdays), checked against the same rules, approved by an owner or admin, posted at ${hour}:00 IST. No links in the post — the link lives in the bio.`}
        right={
          approver ? (
            <ActionForm action={writeTextNow}>
              {active ? <input type="hidden" name="speaker" value={active.id} /> : null}
              <Submit>Write {active ? `for ${active.name.split(" ")[0]}` : "for everyone"} now</Submit>
            </ActionForm>
          ) : null
        }
      />
      <SpeakerTabs base="/text-posts" speakers={sp} active={active?.slug} extra={`status=${status}`} />
      <div className="mb-5 flex gap-4 border-b border-line text-sm">
        {TABS.map((t) => (
          <Link key={t.key} href={`/text-posts?status=${t.key}${active ? `&speaker=${active.slug}` : ""}`} className={`-mb-px border-b-2 pb-2 ${status === t.key ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {rows.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((t) => {
            const blocked = json<any>(t.compliance, {}).status === "block";
            const editable = ["proposed", "rejected"].includes(t.status) || (["approved", "error"].includes(t.status) && approver);
            return (
              <div key={t.id} className="card p-5">
                <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <span className="font-medium text-ink">{t.speaker}</span>
                  <Badge tone={t.platform === "x" ? "gray" : "blue"}>{t.platform === "x" ? "X" : "LinkedIn"}</Badge>
                  {t.angle ? <Badge>{t.angle}</Badge> : null}
                  <span className="tabular-nums">{t.platform === "x" ? `${xLength(t.body)}/280` : `${t.body.length} characters`}</span>
                  <Status s={t.status} />
                  <span className="ml-auto">{ago(t.created_at)}</span>
                </div>
                {editable ? (
                  <ActionForm action={saveTextAction} className="space-y-2">
                    <input type="hidden" name="id" value={t.id} />
                    <textarea name="body" rows={t.platform === "x" ? 4 : 9} className="input text-sm leading-relaxed" defaultValue={t.body} />
                    <Submit className="btn-ghost">Save changes</Submit>
                  </ActionForm>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.body}</p>
                )}
                {t.from_hook ? <p className="mt-2 text-xs text-muted">Tests the reel hook: “{t.from_hook}”</p> : null}
                {t.why ? <p className="mt-1 text-xs text-muted"><b>Why:</b> {t.why}</p> : null}
                <ComplianceNotes compliance={t.compliance} />
                {t.notes ? <p className="mt-2 text-xs text-muted">{t.notes}</p> : null}
                {t.error ? <p className="mt-2 text-xs text-red-600">{t.error}</p> : null}

                <div className="mt-3 flex flex-wrap items-start gap-2">
                  {approver && ["proposed", "rejected"].includes(t.status) ? (
                    <>
                      <ActionForm action={decideTextAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="decision" value="approve" />
                        <input type="hidden" name="seen" value={textPostSeen(t)} />
                        <Submit className="btn-ok" disabled={blocked}>Approve</Submit>
                      </ActionForm>
                      {t.status === "proposed" ? (
                        <ActionForm action={decideTextAction} className="flex items-start gap-2">
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="decision" value="reject" />
                          <input name="note" className="input h-8 w-44 py-1" placeholder="why not (optional)" />
                          <Submit className="btn-ghost">Reject</Submit>
                        </ActionForm>
                      ) : null}
                    </>
                  ) : null}
                  {approver && t.status === "error" ? (
                    <ActionForm action={retryTextAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <Submit className="btn-ghost">Try again</Submit>
                    </ActionForm>
                  ) : null}
                  <CopyButton text={t.body} />
                  {t.permalink ? <a className="btn-ghost" href={t.permalink} target="_blank" rel="noreferrer">Open</a> : null}
                </div>

                {t.status === "posted" ? (
                  <ActionForm action={textNumbersAction} className="mt-3 grid grid-cols-5 gap-2 text-xs">
                    <input type="hidden" name="id" value={t.id} />
                    {["impressions", "likes", "comments", "reposts"].map((k) => (
                      <div key={k}>
                        <label className="label capitalize">{k}</label>
                        <input name={k} className="input h-8 py-1" defaultValue={t[k] ?? ""} />
                      </div>
                    ))}
                    <div className="flex items-end"><Submit className="btn-ghost h-8">Save</Submit></div>
                  </ActionForm>
                ) : null}
                {t.status === "posted" && t.impressions != null ? <p className="mt-1 text-[11px] text-muted">{fmt(t.impressions)} impressions (typed in) — the morning writer learns from the best ones.</p> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty title="Nothing here">
          {status === "proposed" ? (
            <>
              Text posts arrive every morning for speakers with a daily number set ({sp.filter((s) => textPerDay(s).linkedin || textPerDay(s).x).map((s) => s.name.split(" ")[0]).join(", ") || "none yet"} — change it on the Planner).
            </>
          ) : (
            "No posts in this list yet."
          )}
        </Empty>
      )}
      <Section title="Numbers">
        <p className="text-xs text-muted">LinkedIn and X don&apos;t give personal-post numbers through the API without extra approval (and reading X numbers costs per request), so type impressions in a day or two after posting. The writer uses the best ones as examples.</p>
      </Section>
    </div>
  );
}
