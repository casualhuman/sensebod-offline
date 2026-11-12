/** Joins class names, skipping empty ones. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  let out = '';
  for (const part of parts) {
    if (part) out += (out ? ' ' : '') + part;
  }
  return out;
}
