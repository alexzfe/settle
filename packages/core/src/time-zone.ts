// A Home's days. The server's clock is UTC, so an evening in Santiago or Lima is already
// tomorrow there; whatever core dates itself (a Photo with no takenOn, a Fulfilment's bought on,
// the export's file name), and every stored moment shown as a day (Fulfilled on, Archived on, a
// Note's day, in the Agent's text, the refusals, and the exports), is in the Home's own time zone
// instead, so one Fulfilment never shows two days. A Home made before time zones has none, and its
// days stay UTC's until the web gives it the browser's.

/** The day, YYYY-MM-DD, of the ISO timestamp `at` in `timeZone`; UTC's day when there is none. */
export function dayIn(at: string, timeZone: string | null): string {
  if (timeZone === null) return at.slice(0, 10);
  // en-CA writes a date as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

/**
 * `name` as the IANA time zone it names, its case put right ("america/lima" is "America/Lima"), or
 * undefined when it names none. Only a place's zone ("Europe/Kyiv") and UTC are taken: an offset
 * ("+05:00"), a fixed-offset zone ("Etc/GMT+5") and a legacy abbreviation ("EST", "EST5EDT") are
 * refused though the runtime takes them, being wrong for half the year wherever clocks change. A
 * name is kept as given when the runtime knows it by an older one (it calls Kyiv "Europe/Kiev").
 */
export function timeZoneNamed(name: string): string | undefined {
  const utc = /^(Etc\/)?UTC$/i.exec(name);
  if (utc) return utc[1] ? "Etc/UTC" : "UTC";
  if (!/^[A-Za-z]+\/[A-Za-z0-9_\-/]+$/.test(name) || /^Etc\//i.test(name)) return undefined;
  let known: string;
  try {
    known = new Intl.DateTimeFormat("en", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
  return known.toLowerCase() === name.toLowerCase() ? known : name;
}

/** Today in `home`'s time zone, as core dates what it dates itself. */
export function homeToday(now: string, home: { timeZone: string | null }): string {
  return dayIn(now, home.timeZone);
}

/**
 * The time zone every one of `homes` that has one is in, for a day that belongs to them all, such
 * as the Account export's; null (UTC's day) when none has one or they are in different zones.
 */
export function sharedTimeZone(homes: { timeZone: string | null }[]): string | null {
  const zones = new Set(homes.flatMap((home) => (home.timeZone === null ? [] : [home.timeZone])));
  return zones.size === 1 ? ([...zones][0] ?? null) : null;
}
