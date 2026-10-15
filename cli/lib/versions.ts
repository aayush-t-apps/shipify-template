// One way to compare two `x.y.z` versions, for upgrades, releases and the weekly digest.

/** Whether `a` is a newer `x.y.z` than `b`. */
export function newer(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number)) as [number[], number[]];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}
