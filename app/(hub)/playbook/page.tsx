import { raw } from "@/db";
import { requireUser, canApprove } from "@/lib/auth";
import { speakers } from "@/lib/speakers";
import { latestRun } from "@/lib/agents";
import { teacherLatest } from "@/lib/watch";
import { PageHead, Section, Empty, Badge, ago } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { decideRule, saveRule, runAgentNow } from "@/app/actions";

const KIND: Record<string, { label: string; tone: "green" | "violet" | "blue" | "gray" }> = {
  official: { label: "platform says", tone: "green" },
  teacher: { label: "teacher", tone: "violet" },
  learned: { label: "our data", tone: "blue" },
  ours: { label: "ours", tone: "gray" },
};

export default function Playbook() {
  const u = requireUser();
  const approver = canApprove(u);
  const sp = speakers(false);
  const rules = raw<any>(`SELECT r.*, us.name AS decided_name FROM playbook_rules r LEFT JOIN users us ON us.id = r.decided_by ORDER BY r.id`);
  const scopeLabel = (scope: string) => (scope.startsWith("speaker:") ? sp.find((s) => `speaker:${s.id}` === scope)?.name || scope : scope === "all" ? "all platforms" : scope);
  const proposed = rules.filter((r) => r.status === "proposed");
  const active = rules.filter((r) => r.status === "active");
  const retired = rules.filter((r) => r.status === "retired");
  const coach = latestRun("playbook_coach");
  const teaching = teacherLatest(21, 12);

  const Rule = ({ r, children }: { r: any; children?: React.ReactNode }) => (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{r.rule}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Badge tone={KIND[r.kind]?.tone || "gray"}>{KIND[r.kind]?.label || r.kind}</Badge>
          <span>{scopeLabel(r.scope)}</span>
          {r.source_url ? (
            <a href={r.source_url} target="_blank" rel="noreferrer" className="link">{r.source_name || "source"}{r.source_date ? ` · ${r.source_date}` : ""}</a>
          ) : r.source_name ? (
            <span>{r.source_name}</span>
          ) : null}
          {r.proposed_by !== "seed" && r.proposed_by !== "person" ? <span>· proposed by {r.proposed_by.replace("_", " ")}</span> : null}
          {r.decided_name ? <span>· {r.status === "active" ? "on" : r.status} by {r.decided_name}</span> : null}
        </div>
        {r.why ? <div className="mt-1 text-xs text-muted">{r.why}</div> : null}
      </div>
      {approver ? <div className="flex gap-1.5">{children}</div> : null}
    </div>
  );
  const Btn = ({ id, to, label, cls = "btn-ghost" }: { id: number; to: string; label: string; cls?: string }) => (
    <ActionForm action={decideRule}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="to" value={to} />
      <Submit className={cls}>{label}</Submit>
    </ActionForm>
  );

  return (
    <div>
      <PageHead
        title="Playbook"
        sub="The rules every script follows. They come from the platforms, from the teachers we follow and from our own results. Agents only propose; a person switches each rule on."
        right={
          approver ? (
            <ActionForm action={runAgentNow}>
              <input type="hidden" name="agent" value="playbook_coach" />
              <Submit className="btn-ghost">Run Playbook Coach now</Submit>
            </ActionForm>
          ) : null
        }
      />

      {proposed.length ? (
        <Section title={`Waiting for you (${proposed.length})`}>
          <div className="card divide-y divide-line">
            {proposed.map((r) => (
              <Rule key={r.id} r={r}>
                <Btn id={r.id} to="active" label="Switch on" cls="btn-ok" />
                <Btn id={r.id} to="retired" label="No" />
              </Rule>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title={`On (${active.length})`} right={coach ? <span className="text-xs text-muted">Playbook Coach last ran {ago(coach.created_at)}</span> : null}>
        {active.length ? (
          <div className="card divide-y divide-line">
            {active.map((r) => (
              <Rule key={r.id} r={r}>
                <Btn id={r.id} to="retired" label="Switch off" />
              </Rule>
            ))}
          </div>
        ) : (
          <Empty title="No rules on yet" />
        )}
      </Section>

      {approver ? (
        <Section title="Add your own rule">
          <ActionForm action={saveRule} className="card grid gap-2 p-4 md:grid-cols-[1fr_180px]" resetOnOk>
            <input name="rule" className="input" placeholder="One clear, checkable line — e.g. 'Say the number in the first sentence'" required />
            <select name="scope" className="input" defaultValue="all">
              <option value="all">All platforms</option>
              <option value="instagram">Instagram</option>
              <option value="youtube">YouTube</option>
              <option value="linkedin">LinkedIn</option>
              <option value="x">X</option>
              {sp.map((s) => <option key={s.id} value={`speaker:${s.id}`}>Only {s.name}</option>)}
            </select>
            <input name="why" className="input md:col-span-2" placeholder="Why (optional)" />
            <input name="source_url" className="input" placeholder="Source link (optional)" />
            <Submit>Add and switch on</Submit>
          </ActionForm>
        </Section>
      ) : null}

      <Section title="What the teachers posted lately">
        {teaching.length ? (
          <div className="card divide-y divide-line">
            {teaching.map((p) => (
              <a key={p.id} href={p.permalink} target="_blank" rel="noreferrer" className="block px-4 py-2.5 hover:bg-canvas">
                <div className="text-xs text-muted">{p.name} · {ago(p.published_at)}{p.outlier >= 1.5 ? ` · ${Number(p.outlier).toFixed(1)}× their usual` : ""}</div>
                <div className="line-clamp-1 text-sm">{String(p.caption || "").split("\n")[0]}</div>
              </a>
            ))}
          </div>
        ) : (
          <Empty title="Nothing read yet">The teachers on the Trends page are read every morning.</Empty>
        )}
      </Section>

      {retired.length ? (
        <Section title={`Off (${retired.length})`}>
          <div className="card divide-y divide-line opacity-70">
            {retired.map((r) => (
              <Rule key={r.id} r={r}>
                <Btn id={r.id} to="active" label="Switch on" />
              </Rule>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
