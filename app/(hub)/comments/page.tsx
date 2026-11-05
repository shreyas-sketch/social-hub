import Link from "next/link";
import { raw, json } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { setting, env } from "@/lib/config";
import { speakers, speaker as getSpeaker } from "@/lib/speakers";
import { commentRows } from "@/lib/comments";
import { PageHead, Section, Empty, Badge, SpeakerTabs, ago } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { ComplianceNotes } from "@/components/ScriptCard";
import { saveDmRuleAction, switchDmRuleAction, saveReplyDraft, commentsNow } from "@/app/actions";
import { dmRuleSeen } from "@/lib/seen";

const TABS = [
  { key: "questions", label: "To answer" },
  { key: "dms", label: "Comment-to-DM" },
  { key: "all", label: "All comments" },
] as const;

const DM_TONE: Record<string, "green" | "amber" | "red" | "gray"> = { sent: "green", dry_run: "amber", failed: "red", skipped: "gray", sending: "amber" };
const DM_LABEL: Record<string, string> = { sent: "DM sent", dry_run: "DM (dry run)", failed: "DM failed", skipped: "DM skipped", sending: "DM sending" };

export default function Comments({ searchParams }: { searchParams: { tab?: string; speaker?: string } }) {
  const u = requireUser();
  const approver = canApprove(u);
  const sp = speakers();
  const active = searchParams.speaker ? getSpeaker(searchParams.speaker) : undefined;
  const tab = (TABS.find((t) => t.key === searchParams.tab)?.key || "questions") as (typeof TABS)[number]["key"];
  const rows = commentRows(tab, active?.id);
  const rules = raw<any>(`SELECT r.*, sp.name AS speaker, us.name AS approved_name FROM dm_rules r JOIN speakers sp ON sp.id = r.speaker_id LEFT JOIN users us ON us.id = r.approved_by ORDER BY sp.id, r.id`);
  const every = Number(setting("comments_poll_minutes")) || 0;

  return (
    <div>
      <PageHead
        title="Comments"
        sub={`Instagram comments on the last week's posts, ${every ? `read every ${every} minutes` : "read only when you press the button (automatic reading is off in Settings)"}. Someone who comments a speaker's keyword gets one DM with the tracked ₹99 webinar link. Comments that ask something get a drafted reply — an owner or admin approves each one before it posts.`}
        right={
          <>
            <ActionForm action={commentsNow}>
              <Submit className="btn-ghost">Read new comments now</Submit>
            </ActionForm>
            <ActionForm action={commentsNow}>
              <input type="hidden" name="what" value="drafts" />
              {active ? <input type="hidden" name="speaker" value={active.id} /> : null}
              <Submit className="btn-ghost">Draft replies now</Submit>
            </ActionForm>
          </>
        }
      />

      <SpeakerTabs base="/comments" speakers={sp} active={active?.slug} extra={`tab=${tab}`} />
      <div className="mb-5 flex gap-4 border-b border-line text-sm">
        {TABS.map((t) => (
          <Link key={t.key} href={`/comments?tab=${t.key}${active ? `&speaker=${active.slug}` : ""}`} className={`-mb-px border-b-2 pb-2 ${tab === t.key ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "dms" ? (
        <Section title="Keywords">
          <div className="space-y-3">
            {rules.filter((r) => !active || r.speaker_id === active.id).map((r) => (
              <div key={r.id} className="card p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{r.speaker}</span>
                  <Badge tone="violet">{r.keyword}</Badge>
                  <Badge tone={r.status === "on" ? "green" : r.status === "off" ? "gray" : "amber"}>{r.status === "on" ? `on · by ${r.approved_name || "—"}` : r.status === "off" ? "off" : "draft — needs switching on"}</Badge>
                  {approver ? (
                    <ActionForm action={switchDmRuleAction} className="ml-auto">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="to" value={r.status === "on" ? "off" : "on"} />
                      <input type="hidden" name="seen" value={dmRuleSeen(r)} />
                      <Submit className={r.status === "on" ? "btn-ghost" : "btn-ok"} disabled={r.status !== "on" && json<any>(r.compliance, {}).status === "block"}>{r.status === "on" ? "Switch off" : "Switch on"}</Submit>
                    </ActionForm>
                  ) : null}
                </div>
                <ActionForm action={saveDmRuleAction} className="grid gap-2 md:grid-cols-[140px_1fr]">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="speakerId" value={r.speaker_id} />
                  <input name="keyword" className="input" defaultValue={r.keyword} />
                  <textarea name="message" rows={3} className="input text-sm" defaultValue={r.message} />
                  <span className="text-xs text-muted md:pt-2">Public reply (optional)</span>
                  <input name="public_reply" className="input text-sm" defaultValue={r.public_reply || ""} placeholder="e.g. Sent you the link 👍 — left blank, nothing is posted publicly" />
                  <div className="md:col-span-2 flex items-center gap-3">
                    <Submit className="btn-ghost">Save changes</Submit>
                    <span className="text-[11px] text-muted">Changing the words turns it back into a draft until an owner or admin switches it on again.</span>
                  </div>
                </ActionForm>
                <ComplianceNotes compliance={r.compliance} />
              </div>
            ))}
            <ActionForm action={saveDmRuleAction} className="card grid gap-2 p-4 md:grid-cols-[180px_140px_1fr_auto]" resetOnOk>
              <select name="speakerId" className="input" required defaultValue={active?.id || ""}>
                <option value="" disabled>Speaker</option>
                {sp.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input name="keyword" className="input" placeholder="CLASS" required />
              <input name="message" className="input" placeholder="The DM — {link} becomes the tracked webinar link" required />
              <Submit>Add keyword</Submit>
            </ActionForm>
            <p className="text-xs text-muted">
              Meta&apos;s rules: one DM per comment, within 7 days of it; more only if the person writes back. The hub also sends a person the link at most once a day, at most {setting("dm_per_hour")} DMs an hour per account, and never for comments made before the keyword was switched on.
              The Instagram account needs “Allow access to messages” on (Settings → Messages and story replies → Message controls → Connected tools).{env.dryRun() ? " DRY_RUN is on: DMs are logged, not sent." : ""}
            </p>
          </div>
        </Section>
      ) : null}

      <Section title={tab === "questions" ? "Comments that ask something" : tab === "dms" ? "Who got the DM" : "Latest comments"}>
        {rows.length ? (
          <div className="space-y-3">
            {rows.map((c) => (
              <div key={c.id} className="card p-4 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <span className="font-medium text-ink">{c.speaker}</span>
                  <span>@{c.username || "someone"}</span>
                  <span>{ago(c.commented_at)}</span>
                  {c.permalink ? <a className="link" href={c.permalink} target="_blank" rel="noreferrer">on {c.hook || c.title ? `“${String(c.hook || c.title).slice(0, 50)}”` : "this post"}</a> : c.hook ? <span>on “{String(c.hook).slice(0, 50)}”</span> : null}
                  {c.dm_status && DM_LABEL[c.dm_status] ? <Badge tone={DM_TONE[c.dm_status]}>{DM_LABEL[c.dm_status]}{c.keyword ? ` · ${c.keyword}` : ""}</Badge> : null}
                  {c.reply_status === "posted" ? <Badge tone="green">replied</Badge> : c.reply_status === "drafted" ? <Badge tone="violet">reply drafted</Badge> : c.reply_status === "error" ? <Badge tone="red">reply failed</Badge> : null}
                </div>
                <p className="whitespace-pre-wrap">{c.text}</p>
                {c.dm_error ? <p className="mt-1 text-xs text-muted">{c.dm_error}</p> : null}
                {c.dm_status === "failed" && approver ? (
                  <ActionForm action={commentsNow} className="mt-2">
                    <input type="hidden" name="what" value="retry_dm" />
                    <input type="hidden" name="id" value={c.id} />
                    <Submit className="btn-ghost">Try the DM again</Submit>
                  </ActionForm>
                ) : null}
                {c.reply_status === "posted" ? <p className="mt-2 rounded-lg bg-canvas px-3 py-2 text-xs"><b>Reply:</b> {c.reply_text}</p> : null}
                {c.reply_error && c.reply_status !== "posted" ? <p className="mt-1 text-xs text-muted">{c.reply_error}</p> : null}
                {tab === "questions" && c.reply_status !== "posted" && c.reply_status !== "posting" ? (
                  <div className="mt-3 grid gap-2">
                    <ActionForm action={saveReplyDraft} className="grid gap-2">
                      <input type="hidden" name="id" value={c.id} />
                      <textarea name="reply" rows={2} className="input text-sm" defaultValue={c.reply_text || ""} placeholder="Write a reply, or press “Draft replies now”" />
                      <div className="flex flex-wrap gap-2">
                        {approver ? <Submit className="btn-ok" name="do" value="approve">Approve and post</Submit> : null}
                        <Submit className="btn-ghost">Save draft</Submit>
                        <Submit className="btn-ghost" name="do" value="skip">No reply needed</Submit>
                      </div>
                    </ActionForm>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <Empty title="Nothing here">{tab === "questions" ? "Comments that ask something show up here as they come in." : tab === "dms" ? "Once a keyword is switched on, every DM it sends is listed here." : "Comments on the last week's Instagram posts show here."}</Empty>
        )}
      </Section>
    </div>
  );
}
