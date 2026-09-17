// A card: a slightly lighter panel with a hairline border and a very soft shadow.

import type { HTMLAttributes } from "react";
import styles from "./ui.module.css";

/** A card around its children; takes a div's props (className is added to the card's). */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={className ? `${styles.card} ${className}` : styles.card} />;
}
