import { redirect } from "next/navigation";
import { userCount } from "@/lib/auth";
import { ActionForm, Submit } from "@/components/forms";
import { setupOwner } from "@/app/actions";

export default function Setup({ searchParams }: { searchParams: { key?: string } }) {
  if (userCount() > 0) redirect("/login");
  return (
    <ActionForm action={setupOwner} className="space-y-3">
      <h1 className="text-base font-semibold">Create the owner account</h1>
      <p className="text-xs text-muted">This only shows once. The owner adds everyone else from Settings.</p>
      <input type="hidden" name="key" value={searchParams.key || ""} />
      <div>
        <label className="label">Name</label>
        <input className="input" name="name" required />
      </div>
      <div>
        <label className="label">Email</label>
        <input className="input" name="email" type="email" required />
      </div>
      <div>
        <label className="label">Password (10+ characters)</label>
        <input className="input" name="password" type="password" minLength={10} required />
      </div>
      <Submit className="btn-primary w-full">Create and sign in</Submit>
    </ActionForm>
  );
}
