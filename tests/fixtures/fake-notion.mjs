// A stand-in for Notion's API in tool tests: one Tasks database with two pages, a read-only key
// ("read-key"), a write key ("write-key"), and every request logged in FAKE_NOTION_LOG.
//   node fake-notion.mjs <port-file>   writes the port it listens on, then serves until killed
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const DB = "11111111111111111111111111111111";
const DS = "22222222222222222222222222222222";
const RENT = "33333333333333333333333333333333";
const MOM = "44444444444444444444444444444444";
const schema = {
  Name: { id: "title", name: "Name", type: "title", title: {} },
  Status: {
    id: "s",
    name: "Status",
    type: "status",
    status: { options: [{ name: "To do" }, { name: "In progress" }, { name: "Done" }] },
  },
  Due: { id: "d", name: "Due", type: "date", date: {} },
};
const text = (s) => [{ plain_text: s, text: { content: s } }];
const page = (id, name, status, due) => ({
  object: "page",
  id,
  url: `https://www.notion.so/${name.replace(/ /g, "-")}-${id}`,
  parent: { type: "data_source_id", data_source_id: DS, database_id: DB },
  properties: {
    Name: { type: "title", title: text(name) },
    Status: { type: "status", status: { name: status } },
    Due: { type: "date", date: due ? { start: due } : null },
  },
});
const pages = {
  [RENT]: page(RENT, "Pay rent", "To do", "2026-10-03"),
  [MOM]: page(MOM, "Call mom", "Done"),
};
const source = {
  object: "data_source",
  id: DS,
  title: text("Tasks"),
  parent: { type: "database_id", database_id: DB },
  properties: schema,
};

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const key = (req.headers.authorization ?? "").replace("Bearer ", "");
    const path = (req.url ?? "").replace(/^\/v1/, "");
    appendFileSync(
      process.env.FAKE_NOTION_LOG,
      `${req.method} ${path} ${key} ${req.headers["notion-version"]}\n`,
    );
    const send = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (key !== "read-key" && key !== "write-key")
      return send(401, { code: "unauthorized", message: "API token is invalid." });
    const json = body ? JSON.parse(body) : {};
    const writes = req.method === "PATCH" || (req.method === "POST" && path === "/pages");
    if (writes && key !== "write-key")
      return send(403, {
        code: "restricted_resource",
        message: "Insufficient permissions for this endpoint.",
      });
    const match = (re) => re.exec(path);
    const ds = match(/^\/data_sources\/(\w+)$/);
    const db = match(/^\/databases\/(\w+)$/);
    const query = match(/^\/data_sources\/(\w+)\/query$/);
    const pg = match(/^\/pages\/(\w+)$/);
    const children = match(/^\/blocks\/(\w+)\/children/);
    if (req.method === "GET" && path === "/users/me")
      return send(200, { object: "user", name: "Shipify read" });
    if (req.method === "POST" && path === "/search") {
      const q = String(json.query ?? "").toLowerCase();
      const all = [...Object.values(pages), source];
      const kind = json.filter?.value;
      return send(200, {
        results: all.filter(
          (x) =>
            (!kind || x.object === kind) &&
            (x.object === "data_source"
              ? "tasks"
              : x.properties.Name.title[0].plain_text.toLowerCase()
            ).includes(q),
        ),
      });
    }
    if (ds && req.method === "GET")
      return ds[1] === DS
        ? send(200, source)
        : send(404, { code: "object_not_found", message: "Could not find data_source" });
    if (db && req.method === "GET")
      return db[1] === DB
        ? send(200, {
            object: "database",
            id: DB,
            title: text("Tasks"),
            data_sources: [{ id: DS, name: "Tasks" }],
          })
        : send(404, { code: "object_not_found", message: "Could not find database" });
    if (query && req.method === "POST") {
      const not = json.filter?.status?.does_not_equal;
      const rows = Object.values(pages).filter(
        (p) => !not || p.properties.Status.status.name !== not,
      );
      return send(200, { results: rows, has_more: false, next_cursor: null });
    }
    if (pg) {
      const p = pages[pg[1]];
      if (!p) return send(404, { code: "object_not_found", message: "Could not find page" });
      if (req.method === "GET") return send(200, p);
      if (req.method === "PATCH") {
        for (const [name, v] of Object.entries(json.properties ?? {}))
          p.properties[name] = { type: Object.keys(v)[0], ...v };
        return send(200, p);
      }
    }
    if (req.method === "POST" && path === "/pages") {
      const id = "55555555555555555555555555555555";
      const name =
        json.properties?.Name?.title?.[0]?.text?.content ??
        json.properties?.title?.title?.[0]?.text?.content;
      pages[id] = { ...page(id, name, "To do"), children: json.children };
      return send(200, pages[id]);
    }
    if (children && req.method === "GET")
      return send(200, {
        results: [
          {
            type: "paragraph",
            paragraph: { rich_text: text("Rent goes to the landlord's account.") },
          },
        ],
        has_more: false,
      });
    send(404, { code: "object_not_found", message: `No route ${req.method} ${path}` });
  });
});
server.listen(0, "127.0.0.1", () => writeFileSync(process.argv[2], String(server.address().port)));
