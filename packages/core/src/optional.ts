/** The fields that have a value: null and undefined ones are left out. */
export function optional<T extends Record<string, unknown>>(
  fields: T,
): { [K in keyof T]?: Exclude<T[K], null | undefined> } {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null && value !== undefined),
  ) as { [K in keyof T]?: Exclude<T[K], null | undefined> };
}
