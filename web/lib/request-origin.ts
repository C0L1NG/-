/** Validate browser Origin against the public origin or the preserved HTTP Host. */
export function matchesRequestOrigin(
  origin: string | null,
  host: string | null,
  protocol: string,
  configuredOrigin?: string,
): boolean {
  if (!origin || (!host && !configuredOrigin)) return false;
  try {
    const expected = new URL(configuredOrigin || `${protocol}//${host}`);
    const supplied = new URL(origin);
    return (
      ["http:", "https:"].includes(expected.protocol) &&
      supplied.origin === origin &&
      supplied.origin === expected.origin
    );
  } catch {
    return false;
  }
}
