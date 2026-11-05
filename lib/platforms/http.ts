/** fetch with a JSON reply and a readable error that names the platform. */
export async function call<T = any>(platform: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg = body?.error?.message || body?.error_description || body?.message || body?.detail || body?.title || (typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300));
    const err = new Error(`${platform} ${res.status}: ${msg}`) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

export const qs = (o: Record<string, string | number | boolean | undefined | null>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
