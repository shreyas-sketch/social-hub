import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { readToken } from "@/lib/secure";

export default function Done({ searchParams }: { searchParams: { ok?: string; error?: string; e?: string } }) {
  const signedIn = !!currentUser();
  // Only messages the hub signed are shown; this page is public, so a hand-made link can't put its own words here.
  const message = searchParams.e ? readToken<{ m: string }>(searchParams.e)?.m : null;
  if (searchParams.e || searchParams.error) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">That didn&apos;t connect</h1>
        <p className="text-sm text-red-600">{message || "Something went wrong. Try the connect link again."}</p>
        {signedIn ? <Link href="/accounts" className="btn-ghost">Back to Accounts</Link> : <p className="text-sm text-muted">Send this message to the Mudita team.</p>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Connected ✓</h1>
      <p className="text-sm text-muted">{signedIn ? "First numbers arrive in a minute or two." : "All done — you can close this page."}</p>
      {signedIn ? <Link href="/accounts?connected=1" className="btn-primary">Back to Accounts</Link> : null}
    </div>
  );
}
