import { env } from "@/lib/config";

/** One call to the Claude Messages API. Returns the text of the reply. */
export async function claude(opts: { system: string; user: string; maxTokens?: number; temperature?: number }) {
  const key = env.anthropicKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set — add it to the server's env file.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.anthropicModel(),
      max_tokens: opts.maxTokens ?? 8000,
      temperature: opts.temperature ?? 0.8,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${body?.error?.message || JSON.stringify(body).slice(0, 300)}`);
  const text = (body.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  return { text, model: body.model as string, usage: body.usage };
}

/** Pulls the first JSON array or object out of a reply, even if it's wrapped in prose or a code fence. */
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const starts = [src.indexOf("["), src.indexOf("{")].filter((i) => i >= 0);
  if (!starts.length) throw new Error("No JSON in the reply");
  const start = Math.min(...starts);
  const open = src[start];
  const close = open === "[" ? "]" : "}";
  const end = src.lastIndexOf(close);
  if (end <= start) throw new Error("Unclosed JSON in the reply");
  return JSON.parse(src.slice(start, end + 1)) as T;
}
