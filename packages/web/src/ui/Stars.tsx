// A Rating as stars: the Agent's judgement of how good a Listing is, never a score and never
// computed here. Whole stars only, and a Listing that fails a must keeps the same count drawn
// hollow instead of filled, so the shape carries the difference and colour only reinforces it —
// colour is the one channel that can vanish (sunlight, a dimmed screen, colour deficiency)
// without the reader noticing, and red against gold at star size is the hardest pair of all.

import styles from "./ui.module.css";

/** A Rating runs one to five. */
export const STARS = 5;

// One star, in a 24×24 box: filled from its own outline, so both states are the same shape.
const STAR =
  "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";

/**
 * `rating` of five stars, with the count spoken for a reader who cannot see them. `outlined`
 * draws the earned stars hollow, for a Listing that fails a must.
 */
export function Stars({ rating, outlined = false }: { rating: number; outlined?: boolean }) {
  return (
    <span
      className={outlined ? `${styles.stars} ${styles.starsOutlined}` : styles.stars}
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
