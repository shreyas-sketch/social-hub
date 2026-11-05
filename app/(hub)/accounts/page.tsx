import { requireUser, canApprove } from "@/lib/auth";
import { speakers, PLATFORMS, PLATFORM_LABEL } from "@/lib/speakers";
import { accountsFor, followerGrid, publicYoutube } from "@/lib/accounts";
import { PLATFORM_OAUTH, configured } from "@/lib/oauth";
import { bioLink } from "@/lib/publish";
import { CopyButton } from "@/components/forms";
import { PageHead, Section, Status, fmt, ago } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { saveAccount, typeFollowers, disconnectAccount, pullNow, makeConnectLink } from "@/app/actions";

const NOTES: Record<string, string> = {
  instagram: "Must be a Business or Creator account linked to a Facebook Page. Connects together with Facebook.",
  facebook: "The Page linked to the Instagram account. Connects together with Instagram.",
  youtube: "Numbers are public, so they come in with just the YouTube API key. Connecting is only needed later, once Google approves uploads.",
  linkedin: "Posts go out from here. LinkedIn doesn't share personal-profile numbers, so type followers in weekly.",
  x: "Pay-per-use API (about ₹600/month budget — estimated, not measured).",
};

export default function Accounts({ searchParams }: { searchParams: { connected?: string } }) {
  const u = requireUser();
  const approver = canApprove(u);
  const sp = speakers(false);
  const grid = followerGrid();
  return (
    <div>
      <PageHead
        title="Accounts"
        sub="Connecting = the person who owns the login signs in on the platform and says yes. The hub never sees passwords; it keeps an encrypted token."
      />
      {searchParams.connected ? <div className="mb-5 rounded-xl2 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Connected. First numbers arrive in a minute or two.</div> : null}
      {sp.map((s) => {
        const accs = accountsFor(s.id);
        return (
          <Section key={s.id} title={s.name}>
            <div className="card divide-y divide-line">
              {PLATFORMS.map((p) => {
                const a = accs.find((x) => x.platform === p);
                if (!a) return null;
                const g = grid.find((x) => x.id === a.id);
                const oauth = PLATFORM_OAUTH[p];
                const canConnect = configured(oauth);
                return (
                  <div key={p} className="grid gap-3 px-4 py-3 md:grid-cols-[150px_1fr_auto]">
                    <div>
                      <div className="text-sm font-medium">{PLATFORM_LABEL[p]}</div>
                      <Status s={a.status} />
                    </div>
                    <div className="min-w-0 text-sm">
                      {a.handle ? (a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="link">{a.handle}</a> : <span>{a.handle}</span>) : <span className="text-muted">no handle yet</span>}
                      <span className="ml-2 tabular-nums text-muted">{g?.followers != null ? `${fmt(g.followers)} followers` : ""}</span>
                      <div className="text-xs text-muted">
                        {a.last_synced_at ? `numbers ${ago(a.last_synced_at)}` : NOTES[p]}
                        {a.token_expires_at && a.status === "connected" && p !== "youtube" && p !== "x" ? ` · reconnect by ${new Date(a.token_expires_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}` : ""}
                      </div>
                      {a.last_error ? <div className="text-xs text-red-600">{a.last_error}</div> : null}
                      {a.status !== "missing" ? (() => {
                        const bl = bioLink(s.id, p);
                        return bl ? (
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                            <span>Bio link (counts clicks): <span className="font-mono text-ink">{bl.url}</span> · {bl.clicks} clicks</span>
                            <CopyButton text={bl.url} label="Copy" />
                          </div>
                        ) : null;
                      })() : null}
                      {a.status === "missing" && approver ? (
                        <ActionForm action={saveAccount} className="mt-2 flex flex-wrap items-center gap-2">
                          <input type="hidden" name="id" value={a.id} />
                          <input name="handle" className="input h-8 w-40 py-1" placeholder="@handle" defaultValue={a.handle || ""} />
                          <input name="url" className="input h-8 w-56 py-1" placeholder="profile link" defaultValue={a.url || ""} />
                          <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="exists" defaultChecked /> created</label>
                          <Submit className="btn-ghost">Save</Submit>
                        </ActionForm>
                      ) : null}
                      {a.status !== "missing" && approver ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer select-none text-xs text-muted">Edit handle or link</summary>
                          <ActionForm action={saveAccount} className="mt-1 flex flex-wrap items-center gap-2">
                            <input type="hidden" name="id" value={a.id} />
                            <input name="handle" className="input h-8 w-40 py-1" placeholder="@handle" defaultValue={a.handle || ""} />
                            <input name="url" className="input h-8 w-56 py-1" placeholder="https://…" defaultValue={a.url || ""} />
                            <Submit className="btn-ghost">Save</Submit>
                          </ActionForm>
                        </details>
                      ) : null}
                      {p === "linkedin" && a.status !== "missing" ? (
                        <ActionForm action={typeFollowers} className="mt-2 flex items-center gap-2">
                          <input type="hidden" name="id" value={a.id} />
                          <input name="followers" type="number" min={0} className="input h-8 w-32 py-1" placeholder="followers today" />
                          <Submit className="btn-ghost">Save number</Submit>
                        </ActionForm>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-start gap-2 md:justify-end">
                      {a.status !== "missing" && approver ? (
                        canConnect ? (
                          <>
                            <a href={`/api/oauth/${oauth}/start?speaker=${s.id}`} className={a.status === "connected" ? "btn-ghost" : "btn-primary"}>
                              {a.status === "connected" ? "Reconnect" : "Connect here"}
                            </a>
                            <ActionForm action={makeConnectLink} className="max-w-[260px] break-all">
                              <input type="hidden" name="speakerId" value={s.id} />
                              <input type="hidden" name="platform" value={p} />
                              <Submit className="btn-ghost">Link for {s.name.split(" ")[0]}</Submit>
                            </ActionForm>
                          </>
                        ) : (
                          <span className="text-xs text-muted">app keys not set (Settings)</span>
                        )
                      ) : null}
                      {a.status === "connected" || publicYoutube(a) ? (
                        <>
                          <ActionForm action={pullNow}>
                            <input type="hidden" name="id" value={a.id} />
                            <Submit className="btn-ghost">Pull now</Submit>
                          </ActionForm>
                          {approver && a.status === "connected" ? (
                            <ActionForm action={disconnectAccount}>
                              <input type="hidden" name="id" value={a.id} />
                              <Submit className="btn-danger">Disconnect</Submit>
                            </ActionForm>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        );
      })}
    </div>
  );
}
