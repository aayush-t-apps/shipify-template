// Your accounts (ADR 0045), as the variable SHIPIFY_ACCOUNTS holds them: `login:id`, comma-separated,
// as `ship bot repos <account>` writes it. Read the same way by the core (cli/lib/accounts.ts) and
// the edge (/repos). Pure.

/** A GitHub login, as GitHub allows one. */
export const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/**
 * Each account once, in lower case, with GitHub's id when it's pinned; never Shipify's own (`own`).
 * The id is what's trusted: a login given up and registered again by someone else is another id.
 */
export function parseAccounts(
  value: string | undefined,
  own: string,
): { login: string; id?: number }[] {
  const seen = new Map<string, { login: string; id?: number }>();
  for (const part of (value ?? "").split(/[\s,]+/)) {
    const [name, id] = part.trim().toLowerCase().split(":");
    if (!name || !LOGIN.test(name) || name === own.toLowerCase() || seen.has(name)) continue;
    seen.set(name, { login: name, ...(id && /^\d+$/.test(id) ? { id: Number(id) } : {}) });
  }
  return [...seen.values()];
}
