import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { one } from "@/db";
import { LATEST_CUT } from "@/lib/edits";
import { Sidebar } from "@/components/Sidebar";
import { logout } from "@/app/actions";

function counts() {
  const n = (sql: string) => one<{ n: number }>(sql)?.n ?? 0;
  return {
    scripts: n(`SELECT COUNT(*) AS n FROM scripts WHERE status = 'proposed'`),
    shoot: n(`SELECT COUNT(*) AS n FROM scripts WHERE status = 'approved'`),
    edits: n(`SELECT COUNT(*) AS n FROM edits e WHERE e.status = 'ready' AND ${LATEST_CUT}`),
    trials: n(`SELECT COUNT(*) AS n FROM trials WHERE status = 'done' AND verdict = 'pending'`),
    publish: n(`SELECT COUNT(*) AS n FROM publishes WHERE status IN ('manual_todo','error')`),
    accounts: n(`SELECT COUNT(*) AS n FROM accounts WHERE status = 'error'`),
    playbook: n(`SELECT COUNT(*) AS n FROM playbook_rules WHERE status = 'proposed'`),
    sessions: n(`SELECT COUNT(*) AS n FROM sessions WHERE status = 'error'`) + n(`SELECT COUNT(*) AS n FROM longforms WHERE status IN ('ready','manual_todo','error')`),
    text: n(`SELECT COUNT(*) AS n FROM text_posts WHERE status IN ('proposed','error')`),
    comments: n(`SELECT COUNT(*) AS n FROM comments WHERE needs_reply = 1 AND reply_status IN ('drafted','error')`),
  };
}

export default function HubLayout({ children }: { children: ReactNode }) {
  const user = requireUser();
  return (
    <div className="min-h-screen md:pl-56">
      <Sidebar user={user} counts={counts()} logout={logout} />
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
