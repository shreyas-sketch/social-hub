import type { ReactNode } from "react";

export default function ConnectLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-5 flex items-center justify-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold text-white">S</div>
          <div className="font-semibold">Mudita Social Hub</div>
        </div>
        <div className="card p-6">{children}</div>
      </div>
    </div>
  );
}
