// Your accounts (ADR 0045): the GitHub accounts, orgs or users, whose repos are yours besides
// Shipify's own. The repos App installed on one gives Shipify access to it; only this list, the
// variable SHIPIFY_ACCOUNTS (`ship bot repos <account>` adds one), makes it yours. So someone who
// installs the public App on their own account gives you access, and nothing more: their repos stay
// outside (ADR 0044's read profile). A task works on one account, its repo's.
import { parseAccounts } from "../contracts/accounts.ts";
import { copySetting } from "./config.ts";
import { platformRepo } from "./github.ts";

/** Shipify's own account: the one its repo is on, where the bot works. */
export const platformAccount = () => (platformRepo().split("/")[0] ?? "").toLowerCase();

/** The accounts you've added (SHIPIFY_ACCOUNTS, cli/contracts/accounts.ts); never Shipify's own. */
export const accountList = (
  env: NodeJS.ProcessEnv = { SHIPIFY_ACCOUNTS: copySetting("SHIPIFY_ACCOUNTS") },
): { login: string; id?: number }[] => parseAccounts(env.SHIPIFY_ACCOUNTS, platformAccount());

/** The logins of the accounts you've added, each once, in lower case; never Shipify's own. */
export const yourAccounts = (
  env: NodeJS.ProcessEnv = { SHIPIFY_ACCOUNTS: copySetting("SHIPIFY_ACCOUNTS") },
): string[] => accountList(env).map((a) => a.login);

/** SHIPIFY_ACCOUNTS' value for these accounts, as `ship bot repos` writes it. */
export const accountsValue = (list: { login: string; id?: number }[]) =>
  list.map((a) => (a.id ? `${a.login}:${a.id}` : a.login)).join(",");

/** The added account a repo's name (`owner/name`) is on; none for Shipify's own, or anyone else's. */
export function accountOf(name: string, listed = yourAccounts()): string | undefined {
  if (!name.includes("/")) return undefined;
  const owner = (name.split("/")[0] ?? "").toLowerCase();
  return listed.includes(owner) ? owner : undefined;
}

/**
 * The account a task works on, besides Shipify's own: its repo's. From its state once it has one
 * (the repo it changes, or work a talk run found), else the repo its title names, else the first
 * of your accounts its `look at` names. None: Shipify's own. The task step and plan read it with
 * this one function, so the token minted between them is for the account plan works on.
 */
export function taskAccount(
  task: { project?: string; work?: string; titled?: string; looks: string[] },
  listed = yourAccounts(),
): string | undefined {
  const repo = task.project ?? task.work ?? task.titled;
  if (repo !== undefined) return accountOf(repo, listed);
  for (const ref of task.looks) {
    const a = accountOf(ref, listed);
    if (a) return a;
  }
  return undefined;
}
