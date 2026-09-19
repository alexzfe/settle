// What a part of a page shows when it has nothing yet, with a way to ask the Agent for it.

import { AskAgent } from "./AskAgent";
import styles from "./ui.module.css";

/** "No Rooms yet", and when `prompt` is given an AskAgent copying it. */
export function EmptyState({ text, prompt }: { text: string; prompt?: string | undefined }) {
  return (
    <div className={styles.empty}>
      <p>{text}</p>
      {prompt && <AskAgent prompt={prompt} />}
    </div>
  );
}
