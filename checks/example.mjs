// An example check (checks/README.md): the newest release of Node 22, from nodejs.org. A repeat
// with `check example` replies when it changes.
const res = await fetch("https://nodejs.org/dist/index.json", {
  signal: AbortSignal.timeout(20_000),
});
if (!res.ok) {
  console.error(`nodejs.org answered ${res.status}`);
  process.exit(1);
}
const latest = (await res.json()).find((r) => r.version.startsWith("v22."));
console.log(latest ? `Node ${latest.version}, ${latest.date}` : "no Node 22 release listed");
