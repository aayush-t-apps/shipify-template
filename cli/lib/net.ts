// A call across the network that a passing blip doesn't fail: when no answer came back at all, one
// more try, a moment later. An answer, even an error, is never tried again: it's what was said. A
// call that mustn't happen twice (a message sent) is tried again only when the connection itself
// failed, so nothing went out. Each try gets its own time limit.

/** The connection failed before anything was sent: trying again can't do it twice. */
const NOT_SENT = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const notSent = (e: unknown): boolean => {
  const cause = (e as { cause?: { code?: string; errors?: { code?: string }[] } }).cause;
  if (NOT_SENT.has(cause?.code ?? "")) return true;
  // Every address refused the connection (IPv6 and IPv4 tried in turn).
  return Boolean(cause?.errors?.length && cause.errors.every((x) => NOT_SENT.has(x.code ?? "")));
};

export async function fetchAgain(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; once?: boolean; waitMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const f = opts.fetchImpl ?? fetch;
  const attempt = () => f(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000) });
  try {
    return await attempt();
  } catch (e) {
    if (opts.once && !notSent(e)) throw e;
    await new Promise((r) => setTimeout(r, opts.waitMs ?? 1_500));
    return attempt();
  }
}
