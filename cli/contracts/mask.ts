// Anything that looks like a key or a token, hidden before it's posted, sent or logged. Pure, so
// the edge and a box mask the same way.

export function maskSecrets(text: string): string {
  return (
    text
      .replace(
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        "[private key hidden]",
      )
      // GitHub's tokens, in both shapes: 36 letters or digits, and an installation token's
      // stateless one (ghs_<app id>_<JWT>: its app id, then a JWT's three parts).
      .replace(
        /\bgh[pousr]_(?:[A-Za-z0-9]{30,}|\d+_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,
        "[token hidden]",
      )
      .replace(/\bgithub_pat_[A-Za-z0-9_]{40,}/g, "[token hidden]")
      .replace(/\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/g, "[key hidden]")
      .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[key hidden]")
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[token hidden]")
      .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}=*/gi, "$1[hidden]")
      // A value under a name that says it's secret: SOME_API_TOKEN=…, "client_secret": "…".
      .replace(
        /\b([\w-]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key)["']?\s*[:=]\s*["']?)[A-Za-z0-9_\-./+=]{16,}/gi,
        "$1[hidden]",
      )
  );
}
