import { readConnectToken } from "@/lib/secure";
import { speaker } from "@/lib/speakers";

const NAMES: Record<string, string> = { meta: "Instagram + Facebook", youtube: "YouTube", linkedin: "LinkedIn", x: "X (Twitter)" };
const WHAT: Record<string, string> = {
  meta: "You'll sign in to Facebook (the account that manages your Page), choose your Page and Instagram, and allow access. Your Instagram must be a Business or Creator account linked to that Page.",
  youtube: "You'll sign in with the Google account that owns your channel and allow read access to your channel's numbers.",
  linkedin: "You'll sign in to LinkedIn and allow the hub to post on your behalf. Every post is approved by the Mudita team first.",
  x: "You'll sign in to X and allow the hub to post on your behalf. Every post is approved by the Mudita team first.",
};

export default function ConnectInvite({ params }: { params: { token: string } }) {
  const t = readConnectToken(decodeURIComponent(params.token));
  const sp = t ? speaker(t.speakerId) : undefined;
  if (!t || !sp) {
    return <p className="text-sm">This link has expired. Ask the Mudita team for a new one.</p>;
  }
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Connect {sp.name}&apos;s {NAMES[t.oauth]}</h1>
      <p className="text-sm text-muted">{WHAT[t.oauth]}</p>
      <p className="text-sm text-muted">The hub never sees your password. You can remove access any time from the platform&apos;s settings.</p>
      <a href={`/api/oauth/${t.oauth}/start?t=${encodeURIComponent(params.token)}`} className="btn-primary w-full">Continue</a>
    </div>
  );
}
