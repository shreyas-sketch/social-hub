import Link from "next/link";
import { speakers, PLATFORMS, PLATFORM_LABEL, NICHE_LABEL } from "@/lib/speakers";
import { accountsFor } from "@/lib/accounts";
import { PageHead, Badge } from "@/components/ui";

export default function Speakers() {
  const sp = speakers(false);
  return (
    <div>
      <PageHead title="Speakers" sub="Each speaker's direction, content lanes and rules. The morning scripts are written from this." />
      <div className="grid gap-4 md:grid-cols-2">
        {sp.map((s) => {
          const accs = accountsFor(s.id);
          return (
            <Link key={s.id} href={`/speakers/${s.slug}`} className="card block p-5 hover:border-accent">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{s.name}</h3>
                <Badge tone={s.active ? "violet" : "gray"}>{s.active ? NICHE_LABEL[s.niche] : "paused"}</Badge>
              </div>
              <p className="mt-2 line-clamp-3 text-sm text-muted">{s.direction}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.lanes.map((l) => <Badge key={l.key}>{l.name} {l.share}%</Badge>)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {PLATFORMS.map((p) => {
                  const a = accs.find((x) => x.platform === p);
                  const tone = a?.status === "connected" ? "text-emerald-600" : a?.status === "missing" || !a ? "text-red-500" : "text-amber-600";
                  return <span key={p} className={tone}>● {PLATFORM_LABEL[p]}</span>;
                })}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
