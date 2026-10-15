// Your chat channels, as the core sees them (ADR 0031): only their names. The edge holds each
// channel's keys and code (edge/src/), and copies a reply to the chats its hidden line names.

/** Your default channels besides GitHub: the repo variable SHIPIFY_SEND ("telegram,ntfy"). */
export const defaultChannels = (value = process.env.SHIPIFY_SEND): string[] => [
  ...new Set(
    (value ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s !== "github"),
  ),
];
