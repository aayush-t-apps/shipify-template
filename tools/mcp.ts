// The MCP protocol our own tools speak (ADR 0015): JSON-RPC over stdin and stdout, one message per
// line, with the server side of tools only (initialize, tools/list, tools/call, ping). No HTTP, no
// sign-in, no packages: the official SDK brings about 90 for those. Checked against the real
// Claude CLI; tests/tools.test.ts runs it.
import { createInterface } from "node:readline";

export interface Tool {
  name: string;
  description: string;
  /** JSON Schema for the input. */
  inputSchema: Record<string, unknown>;
  /** The answer, as text for the agent. A thrown error becomes an error answer. */
  run(input: Record<string, unknown>): Promise<string>;
}

interface Message {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

/** Serves these tools on stdin and stdout until stdin closes. */
export function serve(
  info: { name: string; version: string },
  tools: Tool[],
  io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } = {
    input: process.stdin,
    output: process.stdout,
  },
): Promise<void> {
  const send = (m: Record<string, unknown>): void => {
    io.output.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  };
  const lines = createInterface({ input: io.input });
  const pending: Promise<void>[] = [];
  lines.on("line", (line) => {
    let m: Message;
    try {
      m = JSON.parse(line) as Message;
    } catch {
      return;
    }
    // A notification (no id) needs no answer.
    if (m.id === undefined) return;
    const id = m.id;
    if (m.method === "initialize")
      send({
        id,
        result: {
          protocolVersion: (m.params?.protocolVersion as string | undefined) ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: info,
        },
      });
    else if (m.method === "ping") send({ id, result: {} });
    else if (m.method === "tools/list")
      send({
        id,
        result: {
          tools: tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        },
      });
    else if (m.method === "tools/call") {
      const name = m.params?.name as string | undefined;
      const tool = tools.find((t) => t.name === name);
      const input = (m.params?.arguments as Record<string, unknown> | undefined) ?? {};
      pending.push(
        (tool ? tool.run(input) : Promise.reject(new Error(`No tool called ${name}.`))).then(
          (text) => send({ id, result: { content: [{ type: "text", text }] } }),
          (e: Error) =>
            send({ id, result: { content: [{ type: "text", text: e.message }], isError: true } }),
        ),
      );
    } else send({ id, error: { code: -32601, message: `Unknown method ${m.method}` } });
  });
  return new Promise((done) =>
    lines.on("close", () => void Promise.all(pending).then(() => done())),
  );
}
