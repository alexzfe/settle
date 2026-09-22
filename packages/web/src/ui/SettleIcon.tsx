// The Settle mark: one circle on a 24×24 grid, where the fill level is the only variable. Taken
// from docs/design/brand/HANDOFF.md, with a className passed through so a caller can color it.
// The stroke thickens as the mark shrinks, so the ring never disappears.

/** 0 empty, 1 low, 2 half, 3 full. */
export type Level = 0 | 1 | 2 | 3;

const CHORDS: readonly (string | null)[] = [
  null,
  "M4.39 16.8A9 9 0 0 0 19.61 16.8Z",
  "M3 12A9 9 0 0 0 21 12Z",
];

/** A status level as the mark. It says nothing to a screen reader: its caller names it. */
export function SettleIcon({
  level = 0,
  size = 22,
  className,
}: {
  level?: Level;
  size?: number;
  className?: string | undefined;
}) {
  const sw = size <= 16 ? 2.8 : size <= 20 ? 2.6 : size <= 28 ? 2.3 : size <= 40 ? 2.1 : 2;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      aria-hidden="true"
    >
      {level === 3 ? (
        <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          {CHORDS[level] && <path d={CHORDS[level]} fill="currentColor" stroke="none" />}
        </>
      )}
    </svg>
  );
}

/** The brand mark, with its waterline at y=15.4: chrome only, never a status. */
export function SettleMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size <= 19 ? 2.8 : size <= 28 ? 2.3 : 2}
      role="img"
      aria-label="Settle"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3.67 15.4A9 9 0 0 0 20.33 15.4Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
