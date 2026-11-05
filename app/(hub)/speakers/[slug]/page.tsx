import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, canApprove } from "@/lib/auth";
import { speaker as getSpeaker, NICHE_LABEL } from "@/lib/speakers";
import { refsFor } from "@/lib/refs";
import { PageHead, Section, Badge, fmt } from "@/components/ui";
import { ActionForm, Submit, CopyButton } from "@/components/forms";
import { saveSpeaker } from "@/app/actions";
import { AddCreators } from "@/components/AddCreators";

export default function SpeakerPage({ params }: { params: { slug: string } }) {
  const u = requireUser();
  const s = getSpeaker(params.slug);
  if (!s) notFound();
  const edit = canApprove(u);
  const refs = refsFor(s.id);
  const lanes = [...s.lanes, ...Array(Math.max(0, 5 - s.lanes.length)).fill(null)].slice(0, 5);
  return (
    <div>
      <PageHead title={s.name} sub={<Badge tone="violet">{NICHE_LABEL[s.niche]}</Badge>} right={<Link href={`/scripts?speaker=${s.slug}`} className="btn-ghost">Scripts</Link>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <ActionForm action={saveSpeaker} className="card space-y-4 p-5">
          <input type="hidden" name="id" value={s.id} />
          <div>
            <label className="label">Direction — what this account is about</label>
            <textarea name="direction" rows={4} className="input" defaultValue={s.direction || ""} disabled={!edit} />
          </div>
          <div>
            <label className="label">Audience</label>
            <textarea name="audience" rows={2} className="input" defaultValue={s.audience || ""} disabled={!edit} />
          </div>
          <div>
            <label className="label">Content lanes (shares must add up to 100%)</label>
            <div className="space-y-2">
              {lanes.map((l, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_70px_2fr]">
                  <input type="hidden" name={`lane_key_${i}`} value={l?.key || ""} />
                  <input name={`lane_name_${i}`} className="input" placeholder="Lane name" defaultValue={l?.name || ""} disabled={!edit} />
                  <input name={`lane_share_${i}`} type="number" min={0} max={100} className="input" placeholder="%" defaultValue={l?.share ?? ""} disabled={!edit} />
                  <input name={`lane_desc_${i}`} className="input" placeholder="What goes in it" defaultValue={l?.desc || ""} disabled={!edit} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Never say / stay away from (one per line)</label>
            <textarea name="stop_list" rows={4} className="input" defaultValue={s.stop_list.join("\n")} disabled={!edit} />
          </div>
          <div>
            <label className="label">Instagram bio (150 characters at most)</label>
            <textarea name="bio" rows={3} maxLength={150} className="input" defaultValue={s.bio || ""} disabled={!edit} />
          </div>
          <div>
            <label className="label">How they speak</label>
            <textarea name="voice_notes" rows={2} className="input" defaultValue={s.voice_notes || ""} disabled={!edit} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">₹99 webinar page (tracking links go here)</label>
              <input name="program_url" className="input" defaultValue={s.program_url || ""} disabled={!edit} />
            </div>
            <div>
              <label className="label">Scripts per day</label>
              <input name="scripts_per_day" type="number" min={0} max={6} className="input" defaultValue={s.scripts_per_day} disabled={!edit} />
            </div>
            <div>
              <label className="label">Caption style for this speaker&apos;s reels</label>
              <select name="caption_style" className="input" defaultValue={s.caption_style || ""} disabled={!edit}>
                <option value="">Hub default (Settings)</option>
                <option value="bold_pop">Bold, word-by-word highlight</option>
                <option value="clean">Clean two-line</option>
                <option value="none">No captions</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Caption disclaimer (added to every caption)</label>
            <textarea name="caption_disclaimer" rows={2} className="input" defaultValue={s.caption_disclaimer || ""} disabled={!edit} />
          </div>
          <div>
            <label className="label">On-screen disclaimer (small text burned into the video)</label>
            <input name="screen_disclaimer" className="input" defaultValue={s.screen_disclaimer || ""} disabled={!edit} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={!!s.active} disabled={!edit} /> Active (writes scripts every morning)
          </label>
          {edit ? <Submit>Save</Submit> : <p className="text-xs text-muted">Only an owner or admin can change this.</p>}
        </ActionForm>

        <div className="space-y-6">
          <Section title="Instagram bio">
            <div className="card p-4 text-sm">
              <p className="whitespace-pre-wrap">{s.bio}</p>
              <div className="mt-3"><CopyButton text={s.bio || ""} label="Copy bio" /></div>
            </div>
          </Section>
          <Section title={`Watchlist (${refs.length})`} right={<Link href={`/watchlist?speaker=${s.slug}`} className="link text-xs">manage</Link>}>
            <div className="card divide-y divide-line text-sm">
              <AddCreators speakerId={s.id} compact />
              {refs.map((r) => (
                <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className={`flex items-center justify-between px-4 py-2 hover:bg-canvas ${r.active ? "" : "opacity-50"}`}>
                  <span>{r.name} <span className="text-xs text-muted">{r.platform}</span></span>
                  <span className="text-xs tabular-nums text-muted">{fmt(r.followers)}</span>
                </a>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
