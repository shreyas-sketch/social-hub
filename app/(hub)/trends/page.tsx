import Link from "next/link";
import { json } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { sources, watchOutliers, WATCH_LABEL, type WatchKind } from "@/lib/watch";
import { latestRun, type TrendBrief } from "@/lib/agents";
import { speakers } from "@/lib/speakers";
import { READABLE } from "@/lib/refs";
import { PageHead, Section, Empty, Badge, fmt, ago, arr, safeHref } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { runAgentNow, addWatch, editWatch, toggleWatch } from "@/app/actions";

const LABEL: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", x: "X", linkedin: "LinkedIn", facebook: "Facebook", other: "Link" };
const firstLine = (s: string | null) => String(s || "").split("\n")[0].slice(0, 160) || "(no caption)";

export default function Trends({ searchParams }: { searchParams: { kind?: string } }) {
  const u = requireUser();
  const approver = canApprove(u);
  const kind: WatchKind = searchParams.kind === "teacher" ? "teacher" : "trend";
  const run = latestRun("trend_scout");
  const brief = json<TrendBrief | null>(run?.output, null);
  const sp = speakers();
  const outs = watchOutliers("trend", 14, 2, 30);
  const list = sources(kind);

  return (
    <div>
      <PageHead
        title="Trends"
        sub="Popular creators outside our niches, read every morning. The Trend Scout agent turns their breakout posts into ideas for each speaker every week."
        right={
          approver ? (
            <ActionForm action={runAgentNow}>
              <input type="hidden" name="agent" value="trend_scout" />
              <Submit className="btn-ghost">Run Trend Scout now</Submit>
            </ActionForm>
          ) : null
        }
      />

      <Section title="This week's trend brief" right={run ? <span className="text-xs text-muted">Trend Scout · {ago(run.created_at)}</span> : null}>
        {brief ? (
          <div className="space-y-4">
            <div className="card p-4 text-sm font-medium">{String(brief.headline || "")}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {arr<any>(brief.patterns).map((p, i) => (
                <div key={i} className="card p-4 text-sm">
                  <div className="font-semibold">{String(p?.pattern ?? "")}</div>
                  <p className="mt-1 text-muted">{String(p?.why ?? "")}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {arr(p?.examples).map((x, k) => {
                      const href = safeHref(x);
                      return href ? <a key={k} href={href} target="_blank" rel="noreferrer" className="link">example {k + 1}</a> : null;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="card divide-y divide-line">
              {arr<any>(brief.per_speaker).map((ps) => {
                const s = sp.find((x) => x.slug === ps?.slug);
                if (!s) return null;
                return (
                  <div key={ps.slug} className="px-4 py-3 text-sm">
                    <div className="mb-1 font-medium">{s.name}</div>
                    <ul className="space-y-1">
                      {arr<any>(ps?.ideas).map((idea, k) => (
                        <li key={k}>
                          {String(idea?.idea ?? idea)} {idea?.format ? <span className="text-xs text-muted">· {String(idea.format)}</span> : null}{" "}
                          {safeHref(idea?.borrowed_from) ? <a href={safeHref(idea.borrowed_from)!} target="_blank" rel="noreferrer" className="link text-xs">source</a> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
            {arr(brief.avoid).length ? (
              <div className="rounded-xl2 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <b>Breaking out, but not for us:</b> {arr(brief.avoid).map(String).join(" · ")}
              </div>
            ) : null}
            <p className="text-xs text-muted">These ideas go into each speaker&apos;s morning scripts for the next 10 days. Nothing posts without approval.</p>
          </div>
        ) : (
          <Empty title="No trend brief yet">The Trend Scout runs every week once the trend pool has been read (it needs one connected Instagram account or the YouTube key). Press &ldquo;Run Trend Scout now&rdquo; after the first morning.</Empty>
        )}
      </Section>

      <Section title="Breakout posts, last 14 days" right={<span className="text-xs text-muted">2× or more of that creator&apos;s own usual</span>}>
        {outs.length ? (
          <div className="card divide-y divide-line">
            {outs.map((o) => (
              <a key={o.id} href={o.permalink} target="_blank" rel="noreferrer" className="flex items-start gap-3 px-4 py-3 hover:bg-canvas">
                <Badge tone="green">{Number(o.outlier).toFixed(1)}×</Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted">{o.name} · {LABEL[o.platform] || o.platform} · {ago(o.published_at)}</div>
                  <div className="line-clamp-2 text-sm">{firstLine(o.caption)}</div>
                </div>
                <div className="text-right text-xs tabular-nums text-muted">
                  {o.views != null ? <div>{fmt(o.views)} views</div> : null}
                  <div>{fmt(o.likes)} likes</div>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <Empty title="Nothing yet">Read every morning with the numbers.</Empty>
        )}
      </Section>

      <Section title="Who we watch">
        <div className="mb-3 flex gap-4 border-b border-line text-sm">
          {(["trend", "teacher"] as WatchKind[]).map((k) => (
            <Link key={k} href={`/trends?kind=${k}`} className={`-mb-px border-b-2 pb-2 ${kind === k ? "border-accent font-medium" : "border-transparent text-muted hover:text-ink"}`}>
              {WATCH_LABEL[k]}
            </Link>
          ))}
        </div>
        <p className="mb-3 text-xs text-muted">
          {kind === "teacher"
            ? "People who teach what's working on social media. The Playbook Coach reads their latest posts every week and proposes rules on the Playbook page."
            : "Popular creators outside our niches, for formats and hooks. Borrow the format, never the topic or the words."}
        </p>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr>
                <th className="th">Creator</th>
                <th className="th">Followers</th>
                <th className="th">Posts read</th>
                <th className="th">Last read</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.id} className={w.active === 1 ? "" : "opacity-50"}>
                  <td className="td">
                    <a href={w.url || "#"} target="_blank" rel="noreferrer" className="font-medium hover:text-accent">{w.name}</a>
                    <div className="text-xs text-muted">
                      {LABEL[w.platform] || w.platform} · {w.handle || w.external_id || ""}
                      {w.language ? ` · ${w.language}` : ""}
                      {!READABLE.includes(w.platform) ? " · link only" : ""}
                      {w.active === 0 ? " · paused" : ""}
                    </div>
                    {w.note ? <div className="text-xs text-muted">{w.note}</div> : null}
                    {w.last_error ? <div className="text-xs text-red-600">{w.last_error}</div> : null}
                  </td>
                  <td className="td tabular-nums">{fmt(w.followers)}</td>
                  <td className="td tabular-nums">{READABLE.includes(w.platform) ? w.posts : "—"}</td>
                  <td className="td text-muted">{READABLE.includes(w.platform) ? ago(w.last_synced_at) : "—"}</td>
                  <td className="td">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <details>
                        <summary className="btn-ghost cursor-pointer list-none">Edit</summary>
                        <ActionForm action={editWatch} className="mt-2 w-64 max-w-full space-y-2 rounded-xl2 border border-line bg-white p-3 text-left">
                          <input type="hidden" name="id" value={w.id} />
                          <input name="name" className="input" defaultValue={w.name} />
                          <input name="note" className="input" defaultValue={w.note || ""} placeholder="What to learn from them" />
                          <Submit>Save</Submit>
                        </ActionForm>
                      </details>
                      {approver ? (
                        <>
                          <ActionForm action={toggleWatch}>
                            <input type="hidden" name="id" value={w.id} />
                            <Submit className="btn-ghost">{w.active === 1 ? "Pause" : "Resume"}</Submit>
                          </ActionForm>
                          <ActionForm action={toggleWatch}>
                            <input type="hidden" name="id" value={w.id} />
                            <input type="hidden" name="do" value="remove" />
                            <Submit className="btn-danger">Remove</Submit>
                          </ActionForm>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length ? (
                <tr>
                  <td className="td text-muted" colSpan={5}>No one yet — add some below.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <ActionForm action={addWatch} className="card mt-3 space-y-2 p-4" resetOnOk>
          <input type="hidden" name="kind" value={kind} />
          <label className="label">Add to {WATCH_LABEL[kind].toLowerCase()} — paste profile links or @handles, one per line</label>
          <textarea name="links" rows={3} className="input font-mono text-xs" placeholder={"https://www.instagram.com/someone/\nhttps://www.youtube.com/@channel"} required />
          <div className="flex flex-wrap items-center gap-2">
            <select name="platform" className="input w-auto" defaultValue="instagram">
              <option value="instagram">Bare @handles are Instagram</option>
              <option value="youtube">Bare @handles are YouTube</option>
            </select>
            <input name="note" className="input w-auto flex-1" placeholder="What to learn from them (optional)" />
            <Submit>Add</Submit>
          </div>
        </ActionForm>
      </Section>
    </div>
  );
}
