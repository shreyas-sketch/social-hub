import { redirect } from "next/navigation";
import { userCount, currentUser } from "@/lib/auth";
import { ActionForm, Submit } from "@/components/forms";
import { login } from "@/app/actions";

export default function Login({ searchParams }: { searchParams: { next?: string } }) {
  if (userCount() === 0) redirect("/setup");
  if (currentUser()) redirect("/");
  return (
    <ActionForm action={login} className="space-y-3">
      <h1 className="text-base font-semibold">Sign in</h1>
      <input type="hidden" name="next" value={searchParams.next || "/"} />
      <div>
        <label className="label">Email</label>
        <input className="input" name="email" type="email" autoComplete="username" required />
      </div>
      <div>
        <label className="label">Password</label>
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Submit className="btn-primary w-full">Sign in</Submit>
    </ActionForm>
  );
}
