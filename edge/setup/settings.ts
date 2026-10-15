// The edge's settings (ADR 0047), on the one list beside the core's (cli/lib/settings.ts): what its
// deploy needs, what it's deployed with, its own secrets on the Worker, and each chat channel's (by
// the names its adapter `needs`). They live with the edge, not in cli/: the core names no host.
import type { Setting } from "../../cli/contracts/index.ts";
import { CHANNELS } from "../src/channels/index.ts";

const DOOR = "`ship door setup`";
const DEPLOYED = "the edge, deployed with it (`ci.yml`)";

const OWN: readonly Setting[] = [
  {
    name: "SHIPIFY_DOOR_APP_ID",
    lives: ["variable"],
    what: "the door App's id",
    setBy: DOOR,
    steps: ["door"],
    readBy: `${DEPLOYED}: its App, matched by id`,
  },
  {
    name: "SHIPIFY_DOOR_SLUG",
    lives: ["variable"],
    what: "the door App's name",
    setBy: DOOR,
    steps: ["door"],
    readBy: "`task.yml`, `watch.yml`: the door App's events start runs; the edge",
  },
  {
    name: "SHIPIFY_DOOR_INSTALLATION",
    lives: ["variable"],
    what: "the door App's install on your copy",
    setBy: DOOR,
    steps: ["door"],
    readBy: DEPLOYED,
  },
  {
    name: "SHIPIFY_DOOR_URL",
    lives: ["variable"],
    what: "the edge's address",
    setBy: DOOR,
    steps: ["door"],
    readBy: `${DEPLOYED}; runs, to reach the door; \`ci.yml\`'s edge job runs once it's set`,
  },
  {
    name: "SHIPIFY_REPO_ID",
    lives: ["variable"],
    what: "your copy's id on GitHub",
    setBy: DOOR,
    steps: ["door"],
    readBy: `${DEPLOYED}: what a run's OIDC token must carry`,
  },
  {
    name: "SHIPIFY_OWNER_ID",
    lives: ["variable"],
    what: "your copy's owner's id on GitHub",
    setBy: DOOR,
    steps: ["door"],
    readBy: `${DEPLOYED}: what a run's OIDC token must carry`,
  },
  {
    name: "SHIPIFY_DOOR_APP_KEY",
    lives: ["worker"],
    what: "the door App's private key (PKCS#8)",
    setBy: `${DOOR} (\`--new\` for a new key)`,
    steps: ["door"],
    readBy: "the edge, alone",
  },
  {
    name: "CF_DEPLOY_TOKEN",
    lives: ["secret", "pc"],
    what: "Cloudflare's deploy token (`shipify-deploy`)",
    setBy: `${DOOR}, from your credentials file`,
    steps: ["door"],
    readBy: "`ci.yml`'s edge deploy; on this PC, `ship door` and `ship add <channel>`",
  },
  {
    name: "CLOUDFLARE_ACCOUNT_ID",
    lives: ["variable", "pc"],
    what: "your Cloudflare account (found with the deploy token)",
    setBy: DOOR,
    steps: ["door"],
    readBy: "`ci.yml`'s edge deploy",
  },
  {
    name: "CF_WORKERS_SUBDOMAIN",
    lives: ["pc"],
    what: "your workers.dev name",
    setBy: `${DOOR} (found with the deploy token)`,
    readBy: "`ship door`: the edge's free address, `shipify.<name>.workers.dev`",
    optional: true,
  },
  {
    name: "APPS_DOMAIN",
    lives: ["variable", "pc"],
    what: "your domain on Cloudflare, for the edge and apps (unset: workers.dev)",
    setBy: `you, in your credentials file; ${DOOR} sets the variable`,
    readBy: "the edge's address, `shipify.<APPS_DOMAIN>`",
    optional: true,
  },
  {
    name: "SHIPIFY_ACCESS",
    lives: ["variable"],
    what: 'the status page\'s Access application: `{"team": "…", "aud": "…"}`, both public',
    setBy: "`ship door page`",
    readBy: "the status page and the web chat: the sign-in the edge checks",
  },
  {
    name: "SHIPIFY_DOOR",
    lives: ["variable"],
    what: "`closed` shuts the door (unset: open)",
    setBy: "you",
    readBy: "the edge: closed, it writes and sends nothing",
    optional: true,
  },
  {
    name: "WEB_PUSH_KEY",
    lives: ["worker"],
    what: "what the web chat's notifications are signed with (a P-256 key, made on your PC)",
    setBy: "`ship add webchat` (`--new` for a new one)",
    readBy: "the edge, alone: unset, the web chat works and notifies no one",
    optional: true,
  },
];

/** The edge's own, then each chat channel's secrets: on the Worker, and kept on this PC. */
export const EDGE_SETTINGS: readonly Setting[] = [
  ...OWN,
  ...Object.entries(CHANNELS).flatMap(([id, ch]) =>
    ch.needs
      .filter((name) => !OWN.some((s) => s.name === name))
      .map(
        (name): Setting => ({
          name,
          lives: ["worker", "pc"],
          what: `${id}'s key`,
          setBy: `\`ship add ${id}\` (\`--new\` for a new one)`,
          readBy: `the edge: ${id}'s messages`,
        }),
      ),
  ),
];
