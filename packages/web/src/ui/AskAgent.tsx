// The way back to the Agent: a button that copies a ready prompt and says where to run it.

import { useEffect, useRef, useState } from "react";
import styles from "./ui.module.css";

/** How long the "Copied" note stays, in milliseconds. */
export const COPIED_NOTE_MS = 6000;

/**
 * A command line starting a Session: `claude "Using the Color Skill: pick a wall color (slug:
 * living-room)"`. The text is escaped for a double-quoted shell string.
 */
export function buildPrompt({
  skill,
  text,
  slug,
}: {
  skill?: string | undefined;
  text: string;
  slug?: string | undefined;
}): string {
  const body = [skill ? `Using the ${skill} Skill: ${text}` : text, slug && `(slug: ${slug})`]
    .filter(Boolean)
    .join(" ");
  return `claude "${body.replace(/[\\"$`]/g, (character) => `\\${character}`)}"`;
}

/** Copies text, through the async clipboard when the page may use it, else a hidden textarea. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the older way.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try {
    return document.execCommand?.("copy") ?? false;
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/**
 * A small secondary "Ask the Agent" button. Clicking copies `prompt` (usually from buildPrompt)
 * and says for a few seconds where to run it; if copying fails, it shows the prompt to copy by hand.
 */
export function AskAgent({
  prompt,
  label = "Ask the Agent",
  homeFolderPath,
}: {
  prompt: string;
  label?: string;
  homeFolderPath?: string | null | undefined;
}) {
  const [result, setResult] = useState<"copied" | "failed">();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const folder = homeFolderPath ? <code>{homeFolderPath}</code> : "your Home Folder";
  return (
    <span className={styles.askAgent}>
      <button
        type="button"
        className="secondary"
        title={prompt}
        onClick={async () => {
          const copied = await copyText(prompt);
          setResult(copied ? "copied" : "failed");
          clearTimeout(timer.current);
          if (copied) timer.current = setTimeout(() => setResult(undefined), COPIED_NOTE_MS);
        }}
      >
        <span aria-hidden>↗</span> {label}
      </button>
      <span aria-live="polite" className={styles.askAgentNote}>
        {result === "copied" && (
          <>
            Copied. Run it with <code>claude</code> in {folder}
          </>
        )}
        {result === "failed" && (
          <>
            Copy this and run it in {folder}: <code className={styles.selectable}>{prompt}</code>
          </>
        )}
      </span>
    </span>
  );
}
