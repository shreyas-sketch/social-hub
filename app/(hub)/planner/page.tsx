import Link from "next/link";
import { istDay } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { planRows, CADENCE_KEYS, CADENCE_LABEL, weekStart, addDays, mixTarget, MIX_LABEL, MIXES } from "@/lib/planner";
import { textPerDay } from "@/lib/textposts";
import { PageHead, Section, Badge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { addShootAction, shootStatusAction, saveCadenceAction } from "@/app/actions";

const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

export default function Planner() {
  const u = requireUser();
  const approver = canApprove(u);
  const today = istDay();
  const monday = weekStart(today);
  const rows = planRows(today);
  const mt = mixTarget();

  return (
    <div>
      <PageHead
        title="Planner"
        sub={`This week (from ${dayLabel(monday)}): what each speaker should post on each platform, what's out, what's on its way, and the shoots booked. Accounts posting 10+ times a week grew about 5× faster than 1–2 a week in Buffer's study of 2.1M posts (measured), and empty weeks hurt.`}
      />

      <Section title="Book a shoot">
        <ActionForm action={addShootAction} className="card grid gap-2 p-4 md:grid-cols-[180px_200px_150px_110px_1fr_auto]" resetOnOk>
          <select name="speakerId" className="input" required defaultValue="">
            <option value="" disabled>Speaker</option>
            {rows.map((r) => <option key={r.sp.id} value={r.sp.id}>{r.sp.name}</option>)}
          </select>
          <select name="kind" className="input" defaultValue="teleprompter">
            <option value="teleprompter">Teleprompter (10–15 scripts)</option>
            <option value="long_session">Long session (60–90 min)</option>
          </select>
          <input name="day" type="date" className="input" min={today} required />
          <input name="time" type="time" className="input" />
          <input name="place" className="input" placeholder="Where / notes" />
          <Submit>Book</Submit>
        </ActionForm>
        <p className="mt-2 text-xs text-muted">The plan from the research: two shoots per speaker a week — one long session and one teleprompter session — about 4 hours of their time.</p>
      </Section>

      <div className="space-y-6">
        {rows.map(({ sp, target, done, pipe, shoots, warnings, mix }) => (
          <div key={sp.id} className="card p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Link href={`/speakers/${sp.slug}`} className="font-semibold hover:text-accent">{sp.name}</Link>
              {warnings.some((w) => w.tone === "red") ? <Badge tone="red">a platform goes quiet this week</Badge> : warnings.length ? <Badge tone="amber">{warnings.length} to look at</Badge> : <Badge tone="green">on plan</Badge>}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr>
                    <th className="th">This week</th>
                    <th className="th text-right">Target</th>
                    <th className="th text-right">Out</th>
                    <th className="th text-right">Coming</th>
                    <th className="th">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {CADENCE_KEYS.filter((k) => target[k] > 0).map((k) => {
                    const pct = Math.min(100, Math.round((done[k] / target[k]) * 100));
                    const withPipe = Math.min(100, Math.round(((done[k] + pipe[k]) / target[k]) * 100));
                    return (
                      <tr key={k}>
                        <td className="td">{CADENCE_LABEL[k]}</td>
                        <td className="td text-right tabular-nums">{target[k]}</td>
                        <td className="td text-right tabular-nums">{done[k]}</td>
                        <td className="td text-right tabular-nums text-muted">{pipe[k]}</td>
                        <td className="td w-48">
                          <div className="relative h-2 w-full overflow-hidden rounded bg-line" title={`${done[k]} out + ${pipe[k]} coming of ${target[k]}`}>
                            <div className="absolute inset-y-0 left-0 bg-accentSoft" style={{ width: `${withPipe}%` }} />
                            <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-muted">Out = posted this week on that account (trial reels and posts made by hand count too). Coming = approved scripts and cuts, winners not yet sent there, approved text posts.</p>
            </div>

            {warnings.length ? (
              <ul className="mt-3 space-y-1 text-sm">
                {warnings.map((w, i) => (
                  <li key={i} className={`rounded-lg px-3 py-1.5 ${w.tone === "red" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{w.text}</li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium text-muted">Shoots, this week and next</div>
                {shoots.length ? (
                  <div className="divide-y divide-line rounded-lg border border-line text-sm">
                    {shoots.map((s) => (
                      <div key={s.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${s.status === "cancelled" ? "opacity-50" : ""}`}>
                        <span className="w-28 text-xs">{dayLabel(s.day)}{s.time ? ` · ${s.time}` : ""}</span>
                        <Badge tone={s.kind === "long_session" ? "violet" : "blue"}>{s.kind === "long_session" ? "long session" : "teleprompter"}</Badge>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted">{s.place || ""}</span>
                        {s.status === "planned" ? (
                          <div className="flex gap-1">
                            {s.kind === "long_session" ? <Link href="/sessions" className="btn-ghost h-7 px-2 py-0 text-xs">Upload</Link> : null}
                            {["done", "missed", "cancelled"].map((st) => (
                              <ActionForm key={st} action={shootStatusAction}>
                                <input type="hidden" name="id" value={s.id} />
                                <input type="hidden" name="status" value={st} />
                                <Submit className="btn-ghost h-7 px-2 py-0 text-xs">{st === "done" ? "Done" : st === "missed" ? "Missed" : "Cancel"}</Submit>
                              </ActionForm>
                            ))}
                          </div>
                        ) : (
                          <Badge tone={s.status === "done" ? "green" : "gray"}>{s.status}</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">Nothing booked.</p>
                )}
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-muted">Scripts in the last 4 weeks: core / next-door / personal (aim {mt.core}/{mt.adjacent}/{mt.personal})</div>
                {mix.total ? (
                  <>
                    <div className="flex h-3 w-full overflow-hidden rounded">
                      {MIXES.map((m, i) => (
                        <div key={m} className={i === 0 ? "bg-accent" : i === 1 ? "bg-sky-400" : "bg-amber-400"} style={{ width: `${(mix[m] / mix.total) * 100}%` }} title={`${MIX_LABEL[m]}: ${mix[m]}`} />
                      ))}
                    </div>
                    <div className="mt-1 flex gap-3 text-xs text-muted">
                      {MIXES.map((m) => <span key={m}>{MIX_LABEL[m]} {Math.round((mix[m] / mix.total) * 100)}%</span>)}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted">No scripts yet.</p>
                )}
                <p className="mt-1 text-[11px] text-muted">The morning writer is told which kind each new script should be, to keep near the aim (Hormozi found broad topics raised views but not sales — self-reported).</p>
              </div>
            </div>

            {approver ? (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer select-none text-xs text-accent">Change {sp.name.split(" ")[0]}&apos;s weekly targets and text posts a day</summary>
                <ActionForm action={saveCadenceAction} className="mt-2 grid gap-2 sm:grid-cols-4">
                  <input type="hidden" name="speakerId" value={sp.id} />
                  {CADENCE_KEYS.map((k) => (
                    <div key={k}>
                      <label className="label">{CADENCE_LABEL[k]} a week</label>
                      <input name={k} type="number" min={0} max={70} className="input" defaultValue={target[k]} />
                    </div>
                  ))}
                  <div>
                    <label className="label">LinkedIn text posts a day (weekdays)</label>
                    <input name="text_linkedin" type="number" min={0} max={3} className="input" defaultValue={textPerDay(sp).linkedin} />
                  </div>
                  <div>
                    <label className="label">X text posts a day</label>
                    <input name="text_x" type="number" min={0} max={5} className="input" defaultValue={textPerDay(sp).x} />
                  </div>
                  <div className="flex items-end sm:col-span-2"><Submit>Save</Submit></div>
                </ActionForm>
              </details>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">Next week starts {dayLabel(addDays(monday, 7))}.</p>
    </div>
  );
}
