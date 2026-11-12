// A Rating as stars: the Agent's judgement of how good a Listing is, never a score and never
// computed here. Whole stars only. A Listing that fails a must keeps the same count, filled in a
// muted stone instead of gold, so earned and unearned stars never share a shape and "3 of 5"
// reads at a glance; the failure itself is the red "Fails a must" line beside them. Colour is the
// one channel that can vanish (sunlight, a dimmed screen, colour deficiency), so it never carries
// the count.

import styles from "./ui.module.css";

/** A Rating runs one to five. */
export const STARS = 5;

// One star, in a 24×24 box: filled from its own outline, so both states are the same shape.
const STAR =
  "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";

/**
 * `rating` of five stars, with the count spoken for a reader who cannot see them. `muted` fills
 * the earned stars in stone rather than gold, for a Listing that fails a must.
 */
export function Stars({ rating, muted = false }: { rating: number; muted?: boolean }) {
  return (
    <span
      className={muted ? `${styles.stars} ${styles.starsMuted}` : styles.stars}
      role="img"
      aria-label={`${rating} of ${STARS} stars`}
    >
      {Array.from({ length: STARS }, (_, position) => (
        <svg
          // The positions are fixed and interchangeable, so their index is their identity.
          key={position}
          className={position < rating ? styles.starOn : styles.starOff}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}
