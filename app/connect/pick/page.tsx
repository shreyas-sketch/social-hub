import { pickerPages } from "@/lib/oauth";
import { speakers } from "@/lib/speakers";
import { currentUser, canApprove } from "@/lib/auth";
import { raw } from "@/db";
import { ActionForm, Submit } from "@/components/forms";
import { pickPages } from "@/app/actions";

export default function Pick({ searchParams }: { searchParams: { state?: string } }) {
  let data: ReturnType<typeof pickerPages>;
  try {
    data = pickerPages(searchParams.state || "");
  } catch (e) {
    return <p className="text-sm text-red-600">{(e as Error).message}</p>;
  }
  const all = speakers(false);
  // A connect link (or a team login) can only connect the link's own speaker.
  const sp = canApprove(currentUser()) ? all : all.filter((s) => s.id === data.speakerId);
  const igHandles = raw<{ speaker_id: number; handle: string | null }>(`SELECT speaker_id, handle FROM accounts WHERE platform = 'instagram'`);
  const expected = (id: number) => igHandles.find((h) => h.speaker_id === id)?.handle?.replace(/^@/, "").toLowerCase();
  const guess = (p: (typeof data.pages)[number]) => {
    const byIg = p.ig ? sp.find((s) => expected(s.id) === p.ig!.username.toLowerCase()) : undefined;
    if (byIg) return byIg.id;
    const byName = sp.find((s) => p.name.toLowerCase().includes(s.name.split(" ")[0].toLowerCase()));
    if (byName) return byName.id;
    return data.pages.length === 1 ? data.speakerId : 0;
  };
  return (
    <ActionForm action={pickPages} className="space-y-4">
      <input type="hidden" name="state" value={searchParams.state} />
      <h1 className="text-lg font-semibold">Which Page belongs to whom?</h1>
      <p className="text-sm text-muted">This Facebook login manages {data.pages.length} Page{data.pages.length > 1 ? "s" : ""}. Choose the speaker for each one you want to connect; leave the rest on “skip”. Check the Instagram name under each Page before you connect.</p>
      <div className="divide-y divide-line rounded-xl2 border border-line">
        {data.pages.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-xs text-muted">{p.ig ? `Instagram @${p.ig.username}` : "no Instagram linked to this Page — link it in the Instagram app first"}</div>
            </div>
            <select name={`page_${p.id}`} className="input w-44" defaultValue={guess(p)}>
              <option value={0}>skip</option>
              {sp.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        ))}
      </div>
      <Submit className="btn-primary w-full">Connect</Submit>
    </ActionForm>
  );
}
