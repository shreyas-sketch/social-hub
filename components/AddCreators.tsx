import { ActionForm, Submit } from "@/components/forms";
import { addRef } from "@/app/actions";

export function AddCreators({ speakerId, compact }: { speakerId: number; compact?: boolean }) {
  return (
    <ActionForm action={addRef} className={`${compact ? "" : "card"} space-y-2 p-4`} resetOnOk>
      <input type="hidden" name="speakerId" value={speakerId} />
      <label className="label">Add creators — paste profile links or @handles, one per line</label>
      <textarea
        name="links"
        rows={3}
        className="input font-mono text-xs"
        placeholder={"https://www.instagram.com/someone/\nhttps://www.youtube.com/@channel\n@handle"}
        required
      />
      <div className="flex flex-wrap items-center gap-2">
        <select name="platform" className="input w-auto" defaultValue="instagram" title="Where a bare @handle lives">
          <option value="instagram">Bare @handles are Instagram</option>
          <option value="youtube">Bare @handles are YouTube</option>
        </select>
        <input name="note" className="input w-auto flex-1" placeholder="Why this creator (optional)" />
        <Submit>Add</Submit>
      </div>
      <p className="text-[11px] text-muted">Instagram and YouTube are read every morning. X, LinkedIn and Facebook links are kept for the team to look at.</p>
    </ActionForm>
  );
}
