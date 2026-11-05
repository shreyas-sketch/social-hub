import Link from "next/link";
import { notFound } from "next/navigation";
import { one, raw, json } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { PageHead, Status, Section, ago } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { ComplianceNotes } from "@/components/ScriptCard";
import { saveScript, decideScript } from "@/app/actions";
import { scriptSeen } from "@/lib/seen";
import { Uploader } from "@/components/Uploader";
import { HookDoctor } from "@/components/HookDoctor";

export default function ScriptPage({ params }: { params: { id: string } }) {
  const u = requireUser();
  const s = one<any>(`SELECT s.*, sp.name AS speaker, sp.slug FROM scripts s JOIN speakers sp ON sp.id = s.speaker_id WHERE s.id = ?`, [Number(params.id)]);
  if (!s) notFound();
  const onScreen = json<{ text: string }[]>(s.on_screen, []).map((o) => o.text).join("\n");
  const editable = ["proposed", "rejected"].includes(s.status) || canApprove(u);
  const edits = raw<any>(`SELECT e.*, v.raw_name FROM edits e JOIN videos v ON v.id = e.video_id WHERE e.script_id = ? ORDER BY e.id DESC`, [s.id]);
  return (
    <div>
      <PageHead
        title={s.title}
        sub={<>{s.speaker} · <Status s={s.status} /> · written {ago(s.created_at)}</>}
        right={
          <>
            <Link href={`/shoot/${s.id}`} className="btn-ghost">Teleprompter</Link>
            {s.status === "proposed" && canApprove(u) ? (
              <ActionForm action={decideScript}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="seen" value={scriptSeen(s)} />
                <input type="hidden" name="decision" value="approve" />
                <Submit className="btn-ok">Approve</Submit>
              </ActionForm>
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <ActionForm action={saveScript} className="card p-5">
          <input type="hidden" name="id" value={s.id} />
          <fieldset disabled={!editable} className="space-y-3">
          <div>
            <label className="label">Title (for us, and the LinkedIn video title)</label>
            <input name="title" className="input" defaultValue={s.title} />
          </div>
          <div>
            <label className="label">Hook — the first 3 seconds, also shown on screen</label>
            <textarea name="hook" rows={2} className="input" defaultValue={s.hook} />
          </div>
          <div>
            <label className="label">{s.source === "clip" ? "What they say (from the recording — can't be changed here)" : "Body"}</label>
            <textarea name="body" rows={9} className="input" defaultValue={s.body} readOnly={s.source === "clip"} />
          </div>
          <div>
            <label className="label">Call to action</label>
            <input name="cta" className="input" defaultValue={s.cta || ""} />
          </div>
          <div>
            <label className="label">On-screen notes (one per line, yellow boxes)</label>
            <textarea name="on_screen" rows={3} className="input" defaultValue={onScreen} />
          </div>
          <div>
            <label className="label">Caption</label>
            <textarea name="caption" rows={4} className="input" defaultValue={s.caption || ""} />
          </div>
          <div>
            <label className="label">Hashtags</label>
            <input name="hashtags" className="input" defaultValue={s.hashtags || ""} />
          </div>
          <div>
            <label className="label">LinkedIn post (goes with the video; no &ldquo;comment YES&rdquo; bait)</label>
            <textarea name="linkedin_text" rows={4} className="input" defaultValue={s.linkedin_text || ""} />
          </div>
          <div>
            <label className="label">Notes for the team</label>
            <input name="notes" className="input" defaultValue={s.notes || ""} />
          </div>
          </fieldset>
          <div className="mt-3">{editable ? <Submit>Save and re-check</Submit> : <p className="text-xs text-muted">Approved — only an owner or admin can change it now.</p>}</div>
        </ActionForm>
        <div className="space-y-6">
          <Section title="Hook Doctor">
            <div className="card p-3">
              <HookDoctor s={s} canEdit={s.status === "proposed" || s.status === "rejected" || canApprove(u)} open />
            </div>
          </Section>
          <Section title="Rules check">
            <div className="card p-4 text-sm">
              <Status s={json<any>(s.compliance, {}).status} />
              <ComplianceNotes compliance={s.compliance} />
              <p className="mt-3 text-xs text-muted">Automatic checks for SEBI / ASCI-style red flags. A guide, not legal advice.</p>
            </div>
          </Section>
          {s.why ? (
            <Section title="Why this script">
              <div className="card p-4 text-sm text-muted">{s.why}</div>
            </Section>
          ) : null}
          {["approved", "shot", "edited"].includes(s.status) && s.source !== "clip" ? (
            <Section title="Raw video">
              <div className="card p-4">
                <Uploader scriptId={s.id} label={edits.length ? "Upload a new take" : "Upload raw video"} />
              </div>
            </Section>
          ) : null}
          {edits.length ? (
            <Section title="Cuts">
              <div className="card divide-y divide-line text-sm">
                {edits.map((e) => (
                  <Link key={e.id} href={`/edits/${e.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-canvas">
                    <span>v{e.version} · {e.raw_name}</span>
                    <Status s={e.status} />
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
