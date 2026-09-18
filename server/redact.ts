const sensitive =
  /password|passwd|pwd|token|secret|authorization|cookie|api[-_]?key|csrf/i;
export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[深度截断]";
  if (Array.isArray(value))
    return value.slice(0, 1000).map((v) => redactObject(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        sensitive.test(key) ? "[已脱敏]" : redactObject(v, depth + 1),
      ]),
    );
  return typeof value === "string" ? redactText(value) : value;
}
export function redactText(text: string) {
  return text
    .slice(0, 262144)
    .replace(/Bearer\s+[\w.+/=-]+/gi, "Bearer [已脱敏]")
    .replace(
      /((?:password|passwd|pwd|token|secret|api[-_]?key|authorization|cookie)\s*[=:]\s*)[^\s,;&"'<>]+/gi,
      "$1[已脱敏]",
    );
}
export function redactBody(text: string | undefined) {
  if (!text) return undefined;
  try {
    return JSON.stringify(redactObject(JSON.parse(text)), null, 2);
  } catch {
    return redactText(text);
  }
}
export function redactHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      sensitive.test(key) ? "[已脱敏]" : redactText(value),
    ]),
  );
}
export function redactUrl(value: string) {
  try {
    const u = new URL(value);
    for (const key of u.searchParams.keys())
      if (sensitive.test(key)) u.searchParams.set(key, "[已脱敏]");
    u.username = "";
    u.password = "";
    u.hash = "";
    return u.toString();
  } catch {
    return redactText(value);
  }
}
