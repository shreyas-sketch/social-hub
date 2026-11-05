"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, FileText, Video, Scissors, FlaskConical, Send, BarChart3, Users, Link2, Eye, Settings, LogOut, TrendingUp, BookOpen,
  Clapperboard, MessageCircle, Type, CalendarDays, Gauge, Mic,
} from "lucide-react";

const GROUPS: { title?: string; items: { href: string; label: string; icon: any; count?: string }[] }[] = [
  { items: [{ href: "/", label: "Today", icon: LayoutDashboard }] },
  {
    title: "Make",
    items: [
      { href: "/scripts", label: "Scripts", icon: FileText, count: "scripts" },
      { href: "/sessions", label: "Long sessions", icon: Clapperboard, count: "sessions" },
      { href: "/shoot", label: "Shoot", icon: Video, count: "shoot" },
      { href: "/edits", label: "Edits", icon: Scissors, count: "edits" },
      { href: "/text-posts", label: "Text posts", icon: Type, count: "text" },
    ],
  },
  {
    title: "Post",
    items: [
      { href: "/trials", label: "Trials", icon: FlaskConical, count: "trials" },
      { href: "/publish", label: "Publish", icon: Send, count: "publish" },
      { href: "/comments", label: "Comments", icon: MessageCircle, count: "comments" },
    ],
  },
  {
    title: "Grow",
    items: [
      { href: "/planner", label: "Planner", icon: CalendarDays },
      { href: "/growth", label: "Growth", icon: Gauge },
      { href: "/insights", label: "Insights", icon: BarChart3 },
      { href: "/guests", label: "Guests & collabs", icon: Mic },
    ],
  },
  {
    title: "Learn",
    items: [
      { href: "/watchlist", label: "Watchlist", icon: Eye },
      { href: "/trends", label: "Trends", icon: TrendingUp },
      { href: "/playbook", label: "Playbook", icon: BookOpen, count: "playbook" },
    ],
  },
  {
    title: "Set up",
    items: [
      { href: "/speakers", label: "Speakers", icon: Users },
      { href: "/accounts", label: "Accounts", icon: Link2, count: "accounts" },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Sidebar({ user, counts, logout }: { user: { name: string; role: string }; counts: Record<string, number>; logout: () => Promise<void> }) {
  const path = usePathname();
  return (
    <aside className="flex w-full flex-col bg-sidebar text-white md:fixed md:inset-y-0 md:left-0 md:w-56">
      <div className="flex items-center gap-2 px-5 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold">S</div>
        <div>
          <div className="text-sm font-semibold leading-tight">Social Hub</div>
          <div className="text-[11px] text-white/50">Mudita · internal</div>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-0 md:overflow-y-auto md:overflow-x-visible">
        {GROUPS.map((g, gi) => (
          <div key={gi} className="contents md:block md:pb-2">
            {g.title ? <div className="hidden px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/35 md:block">{g.title}</div> : null}
            {g.items.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              const c = n.count ? counts[n.count] || 0 : 0;
              const Icon = n.icon;
              return (
                <Link key={n.href} href={n.href} className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm ${active ? "bg-sidebarHover text-white" : "text-white/70 hover:bg-sidebarHover hover:text-white"}`}>
                  <Icon className="h-4 w-4" />
                  <span className="flex-1">{n.label}</span>
                  {c > 0 ? <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums">{c}</span> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="flex items-center justify-between border-t border-white/10 px-5 py-3 md:block">
        <div>
          <div className="text-sm">{user.name}</div>
          <div className="text-[11px] capitalize text-white/50">{user.role}</div>
        </div>
        <form action={logout} className="md:mt-2">
          <button className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
        </form>
      </div>
    </aside>
  );
}
