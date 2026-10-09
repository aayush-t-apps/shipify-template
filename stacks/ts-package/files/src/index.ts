// {{APP_NAME}}: {{APP_DESCRIPTION}}
// Replace this example with the package's API. Everything exported here is public.

/** Example export. */
export function greet(name: string): string {
  const who = name.trim() || "world";
  return `Hello, ${who}!`;
}
