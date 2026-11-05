import { requireUser } from "@/lib/auth";
import { speakers } from "@/lib/speakers";
import { guestRows, GUEST_KINDS, GUEST_STATUSES } from "@/lib/guests";
import { PageHead, Section, Empty, Badge, fmt, arr } from "@/components/ui";
import { ActionForm, Submit, CopyButton } from "@/components/forms";
import { saveGuestAction, guestHelperAction } from "@/app/actions";

const TONE: Record<string, "gray" | "violet" | "blue" | "amber" | "green" | "red"> = { idea: "gray", pitched: "violet", booked: "blue", recorded: "amber", live: "green", declined: "gray" };
const shortDay = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");

export default function Guests() {
  requireUser();
  const sp = speakers();
  const rows = guestRows();

  const Fields = ({ g }: { g?: any }) => (
    <>
      {g ? <input type="hidden" name="id" value={g.id} /> : null}
      <select name="speakerId" className="input" required defaultValue={g?.speaker_id || ""}>
        <option value="" disabled>Speaker</option>
        {sp.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select name="kind" className="input" defaultValue={g?.kind || "podcast"}>
        {Object.entries(GUEST_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input name="name" className="input" placeholder="Show or creator" defaultValue={g?.name || ""} required />
      <input name="url" className="input" placeholder="Link (https://…)" defaultValue={g?.url || ""} />
      <input name="audience" className="input" placeholder="Their followers / subscribers" defaultValue={g?.audience ?? ""} />
      <input name="contact" className="input" placeholder="Contact (email, DM, person)" defaultValue={g?.contact || ""} />
      <select name="status" className="input" defaultValue={g?.status || "idea"}>
        {GUEST_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <div>
        <label className="label">Next follow-up</label>
        <input name="next_on" type="date" className="input" defaultValue={g?.next_on || ""} />
      </div>
      <div>
        <label className="label">Went live on</label>
        <input name="live_on" type="date" className="input" defaultValue={g?.live_on || ""} />
      </div>
      <input name="live_url" className="input" placeholder="Live link" defaultValue={g?.live_url || ""} />
      <textarea name="notes" rows={2} className="input sm:col-span-2" placeholder="Notes" defaultValue={g?.notes || ""} />
    </>
  );

  return (
    <div>
      <PageHead
        title="Guests & collabs"
        sub="Podcast guest spots and collaborations with bigger creators: who to pitch, where each one stands, and what it did for followers. The evidence here is thin (no Indian before-and-after numbers were found), so the hub measures it: followers the day it went live and a week later."
      />

      <Section title="Add one">
        <ActionForm action={saveGuestAction} className="card grid gap-2 p-4 sm:grid-cols-4" resetOnOk>
          <Fields />
          <div className="flex items-end"><Submit>Add</Submit></div>
        </ActionForm>
        <p className="mt-2 text-xs text-muted">Collab posts on Instagram: set up to 3 collaborators on a cut (Edits page). It then goes out as a normal reel — Instagram doesn&apos;t allow collaborators on trial reels.</p>
      </Section>

      <Section title={`Pipeline (${rows.length})`}>
        {rows.length ? (
          <div className="space-y-3">
            {rows.map((g) => (
              <div key={g.id} className="card p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{g.name}</span>
                  <Badge tone={TONE[g.status] || "gray"}>{g.status}</Badge>
                  <span className="text-xs text-muted">{g.speaker} · {GUEST_KINDS[g.kind] || g.kind}{g.audience ? ` · ${fmt(g.audience)} followers` : ""}</span>
                  {g.next_on && !["live", "declined"].includes(g.status) ? <Badge tone="amber">follow up {shortDay(g.next_on)}</Badge> : null}
                  {g.url ? <a className="link text-xs" href={g.url} target="_blank" rel="noreferrer">link</a> : null}
                  {g.live_url ? <a className="link text-xs" href={g.live_url} target="_blank" rel="noreferrer">the episode</a> : null}
                </div>
                {g.lift?.length ? (
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    {g.lift.map((l: any) => (
                      <span key={l.platform} className="rounded-lg bg-canvas px-2 py-1">
                        {l.platform}: {fmt(l.before)} on {shortDay(g.live_on)} → {l.after != null ? `${fmt(l.after)} a week later (${l.after - l.before >= 0 ? "+" : ""}${fmt(l.after - l.before)})` : "a week later: not yet"}
                      </span>
                    ))}
                    <span className="text-muted">measured — other posts that week count too</span>
                  </div>
                ) : null}
                {g.notes ? <p className="mt-2 text-xs text-muted">{g.notes}</p> : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionForm action={guestHelperAction}>
                    <input type="hidden" name="id" value={g.id} />
                    <input type="hidden" name="what" value="pitch" />
                    <Submit className="btn-ghost">{g.pitch ? "Draft the pitch again" : "Draft a pitch"}</Submit>
                  </ActionForm>
                  <ActionForm action={guestHelperAction}>
                    <input type="hidden" name="id" value={g.id} />
                    <input type="hidden" name="what" value="prep" />
                    <Submit className="btn-ghost">{g.prep ? "Prep brief again" : "Prep brief"}</Submit>
                  </ActionForm>
                </div>

                {g.pitch ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer select-none text-xs text-accent">Pitch draft (you send it yourself)</summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-canvas p-3 text-xs">{g.pitch}</pre>
                    <CopyButton text={g.pitch} />
                  </details>
                ) : null}
                {g.prepJson ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer select-none text-xs text-accent">Prep brief</summary>
                    <div className="mt-2 space-y-2 rounded-lg bg-canvas p-3 text-xs">
                      {arr(g.prepJson.stories).length ? <div><b>Stories to tell</b><ul className="list-disc pl-5">{arr(g.prepJson.stories).map((x, i) => <li key={i}>{String(x)}</li>)}</ul></div> : null}
                      {arr(g.prepJson.questions).length ? <div><b>Likely questions</b><ul className="list-disc pl-5">{arr<any>(g.prepJson.questions).map((q, i) => <li key={i}>{String(q?.q ?? q)}{q?.angle ? <> — <span className="text-muted">{String(q.angle)}</span></> : null}</li>)}</ul></div> : null}
                      {arr(g.prepJson.avoid).length ? <div><b>Don&apos;t say</b><ul className="list-disc pl-5">{arr(g.prepJson.avoid).map((x, i) => <li key={i}>{String(x)}</li>)}</ul></div> : null}
                      {g.prepJson.plug ? <div><b>Where to find them:</b> {String(g.prepJson.plug)}</div> : null}
                    </div>
                  </details>
                ) : null}

                <details className="mt-2">
                  <summary className="cursor-pointer select-none text-xs text-muted">Edit</summary>
                  <ActionForm action={saveGuestAction} className="mt-2 grid gap-2 sm:grid-cols-4">
                    <Fields g={g} />
                    <div className="flex items-end"><Submit className="btn-ghost">Save</Submit></div>
                  </ActionForm>
                </details>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="Nothing yet">Start with 3–5 Indian podcasts or creators per speaker whose audience is 35–55 professionals and business owners.</Empty>
        )}
      </Section>
    </div>
  );
}
