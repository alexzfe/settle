# Settle — mark handoff

Everything here is one circle on a 24×24 grid. Fill level is the only variable.

## Files

| File | Use |
|---|---|
| `mark/settle-mark.svg` | Brand mark, 20px and up. `currentColor`. |
| `mark/settle-mark-small.svg` | Brand mark, 16–19px (heavier ring). |
| `mark/favicon.svg` | Browser tab. Auto light/dark. |
| `mark/app-icon-dark.svg` / `-paper.svg` | 512×512 source for app icons, PWA, store listings. |
| `states/state-01…04.svg` | In-product status icons. |

## Geometry

- Grid: 24×24. Circle: `cx=12 cy=12 r=9`.
- Brand waterline: chord at **y=15.4** (half-width 8.33) → `M3.67 15.4 A9 9 0 0 0 20.33 15.4 Z`.
- Stroke scales with size so the ring never disappears:

| Rendered size | stroke-width (grid units) |
|---|---|
| 16px | 2.8 |
| 20px | 2.6 |
| 28px | 2.3 |
| 40px | 2.1 |
| 56px+ | 2.0 |

- Clearspace: 25% of the mark's diameter on all sides. Minimum size: 16px.

## The four status levels

| Level | Chord | Meaning (rename to your states) |
|---|---|---|
| 01 empty | ring only | nothing logged yet |
| 02 low | y=16.8 | early activity |
| 03 half | y=12.0 | actively in progress |
| 04 full | solid disc | **terminal / settled** |

**Two rules.** (1) The logo's waterline (y=15.4) is never used as a status — it belongs to chrome only (header, tab, splash, marketing). (2) Only the terminal state is drawn in the accent colour; every other level is ink. Ink = in progress, accent = done.

Map your own state names onto levels 01–04. If you have five states, add a chord between 02 and 03 (e.g. y=14.2, half-width 8.7) rather than introducing a new shape — and keep clear of 15.4.

Chord maths, if you need another level: `halfWidth = sqrt(81 − (y − 12)²)`, path `M(12−hw) y A9 9 0 0 0 (12+hw) y Z`.

## Colour

Placeholders only — swap for your real tokens. The mark is monochrome by design; it inherits `color`.

| Token | Placeholder | Notes |
|---|---|---|
| `--ink` | `#1A1815` | mark on light |
| `--paper` | `#F6F3EE` | mark on dark |
| `--accent` | `#2E6A64` | terminal state only |

The mark must stay legible in one colour, black on white, and at 16px. Don't add gradients, shadows, or a second colour inside the circle.

## React component

```tsx
type Level = 0 | 1 | 2 | 3;              // empty | low | half | full
const CHORDS = [null, 'M4.39 16.8A9 9 0 0 0 19.61 16.8Z', 'M3 12A9 9 0 0 0 21 12Z'] as const;

export function SettleIcon({ level = 0, size = 22 }: { level?: Level; size?: number }) {
  const sw = size <= 16 ? 2.8 : size <= 20 ? 2.6 : size <= 28 ? 2.3 : size <= 40 ? 2.1 : 2;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={sw} aria-hidden="true">
      {level === 3
        ? <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
        : <>
            <circle cx="12" cy="12" r="9" />
            {CHORDS[level] && <path d={CHORDS[level]!} fill="currentColor" stroke="none" />}
          </>}
    </svg>
  );
}

// Brand mark — chrome only. Never pass this a status level.
export function SettleMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={size <= 19 ? 2.8 : size <= 28 ? 2.3 : 2} role="img" aria-label="Settle">
      <circle cx="12" cy="12" r="9" />
      <path d="M3.67 15.4A9 9 0 0 0 20.33 15.4Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
```

Colour the terminal state at the call site: `<SettleIcon level={3} className="text-accent" />`.

## Head tags

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png"><!-- 180×180, paper ground -->
<link rel="manifest" href="/site.webmanifest"><!-- 192 + 512 maskable, ink ground -->
```

Raster exports still needed from the 512 sources: `favicon-32.png`, `apple-touch-icon.png` (180, paper), `icon-192.png` / `icon-512.png` (ink, maskable), `og-image.png` (1200×630, lockup centred on ink).

## Lockup

Mark + `settle`, all lowercase, set at the mark's cap height, letter-spacing −0.04em, weight 500. Gap between mark and word = 45% of the mark's diameter. Typeface in the comps is Instrument Sans — replace with your product face if it differs, and outline the wordmark before shipping it as an asset.
