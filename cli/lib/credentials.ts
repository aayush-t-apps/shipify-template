import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

/** ~/.config/shipify/credentials.env, or SHIPIFY_CREDENTIALS (read each time: a test sets its own). */
export const credentialsFile = () =>
  process.env.SHIPIFY_CREDENTIALS ?? join(homedir(), ".config", "shipify", "credentials.env");

export interface CredentialState {
  file: string;
  exists: boolean;
  /** true when group/other can read the file */
  tooOpen: boolean;
  /** NAME=value lines from the file. Read them with credential(), where the environment wins. */
  values: Record<string, string>;
}

/**
 * Local credentials, by name. Stacks say which names they need (stack.json `deploy`); `publish`
 * copies values into repository secrets through stdin and never prints them (ADR 0006).
 */
export function loadCredentials(): CredentialState {
  const file = credentialsFile();
  const state: CredentialState = { file, exists: existsSync(file), tooOpen: false, values: {} };
  if (state.exists) {
    state.tooOpen = (statSync(file).mode & 0o077) !== 0;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m?.[1] && m[2]) state.values[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return state;
}

/** A credential by name: the environment first, then the file. */
export function credential(values: Record<string, string>, name: string): string | undefined {
  return process.env[name] || values[name];
}

/**
 * Keep one credential in the file, replacing its line or adding one, readable by you alone. Only
 * a command you run with --yes calls this (`ship door setup`), and nothing prints the value.
 */
export function setCredential(name: string, value: string, file = credentialsFile()): void {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name) || /\s/.test(value))
    throw new Error(`Not a credential: ${name}`);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  const at = lines.findIndex((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
  if (at >= 0) lines[at] = `${name}=${value}`;
  else {
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(`${name}=${value}`, "");
  }
  writeFileSync(file, lines.join("\n"), { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** A credential's line gone from the file (`ship remove`): nothing else changes. */
export function forgetCredential(name: string, file = credentialsFile()): void {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8").split("\n");
  const kept = lines.filter((l) => !new RegExp(`^\\s*${name}\\s*=`).test(l));
  if (kept.length !== lines.length) writeFileSync(file, kept.join("\n"), { mode: 0o600 });
}

/**
 * One line, typed with nothing shown: a key you paste (`ship add`, `ship setup`). The terminal's,
 * unless a test's. What's typed is never echoed, and the answer comes back trimmed.
 */
export async function hidden(
  question: string,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<string> {
  const rl = createInterface({ input, output, terminal: true });
  const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
  let asking = true;
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
    if (asking) write.call(rl, s);
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      output.write("\n");
      resolve(answer.trim());
    });
    asking = false;
  });
}
