import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-sidebar px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-white">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent font-bold">S</div>
          <div className="text-lg font-semibold">Social Hub</div>
        </div>
        <div className="rounded-xl2 bg-white p-6 shadow-card">{children}</div>
      </div>
    </div>
  );
}
