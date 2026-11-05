"use client";
import { useFormState, useFormStatus } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Loader2 } from "lucide-react";

export type Result = { ok: boolean; msg: string } | null;
type Action = (prev: Result, fd: FormData) => Promise<Result>;

/** A form that runs a server action and shows what happened right under it. */
export function ActionForm({ action, children, className, resetOnOk }: { action: Action; children: ReactNode; className?: string; resetOnOk?: boolean }) {
  const [state, formAction] = useFormState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  // Clear the form only when the action worked — a refused entry keeps what was typed, so it can be fixed.
  useEffect(() => {
    if (resetOnOk && state?.ok) ref.current?.reset();
  }, [state, resetOnOk]);
  return (
    <form
      ref={ref}
      action={async (fd) => {
        await formAction(fd);
      }}
      className={className}
    >
      {children}
      {state ? <p className={`mt-1.5 text-xs ${state.ok ? "text-emerald-700" : "text-red-600"}`}>{state.msg}</p> : null}
    </form>
  );
}

export function Submit({ children, className = "btn-primary", name, value, disabled }: { children: ReactNode; className?: string; name?: string; value?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} name={name} value={value} disabled={pending || disabled}>
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const t = document.createElement("textarea");
          t.value = text;
          document.body.appendChild(t);
          t.select();
          document.execCommand("copy");
          t.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : label}
    </button>
  );
}
