export function toIso(sec: bigint | number) {
  const n = typeof sec === "number" ? sec : Number(sec);
  return new Date(n * 1000).toISOString();
}
