"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

const CHUNK = 8 * 1024 * 1024;

/**
 * Sends the raw video in 8 MB pieces. If the connection drops, it asks the
 * server how much arrived and carries on from there — a 1 GB file on office
 * Wi-Fi shouldn't have to start again.
 */
export function Uploader({ scriptId, sessionId, label = "Upload raw video" }: { scriptId?: number; sessionId?: number; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function send(file: File) {
    setMsg(null);
    setPct(0);
    try {
      const start = await fetch("/api/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "start", scriptId, sessionId, name: file.name, size: file.size }),
      }).then((r) => r.json());
      if (!start.ok) throw new Error(start.error || "Couldn't start the upload");
      let offset = 0;
      let tries = 0;
      while (offset < file.size) {
        const end = Math.min(offset + CHUNK, file.size);
        try {
          const r = await fetch(`/api/upload?u=${start.id}&offset=${offset}`, { method: "PUT", body: file.slice(offset, end) });
          const j = await r.json();
          if (!j.ok) throw new Error(j.error || "Upload failed");
          offset = j.received;
          tries = 0;
          setPct(Math.round((offset / file.size) * 100));
        } catch (e) {
          if (++tries > 6) throw e;
          setMsg(`Connection hiccup — retrying (${tries}/6)…`);
          await new Promise((r) => setTimeout(r, 2000 * tries));
          const st = await fetch(`/api/upload?u=${start.id}`).then((r) => r.json()).catch(() => null);
          if (st?.ok) offset = st.received;
        }
      }
      setMsg(sessionId ? "Uploaded. Checking the file…" : "Uploaded. Making the first cut…");
      const fin = await fetch("/api/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step: "finish", id: start.id }) }).then((r) => r.json());
      if (!fin.ok) throw new Error(fin.error || "Couldn't finish the upload");
      setMsg(sessionId ? "Uploaded — the hub writes the transcript first (this takes a while for a long recording), then picks the clips. This page shows when they're ready." : "Uploaded — the cut will be ready in a few minutes on the Edits page.");
      setPct(null);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
      setPct(null);
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) send(f);
          e.target.value = "";
        }}
      />
      <button type="button" className="btn-primary" disabled={pct !== null} onClick={() => input.current?.click()}>
        <Upload className="h-3.5 w-3.5" />
        {pct !== null ? `Uploading ${pct}%` : label}
      </button>
      {pct !== null ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-line">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {msg ? <p className="mt-1.5 text-xs text-muted">{msg}</p> : null}
    </div>
  );
}
