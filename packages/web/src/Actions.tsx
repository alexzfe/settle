import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import styles from "./Actions.module.css";
import appStyles from "./App.module.css";
import { queriesShowing } from "./liveUpdates";

export interface Action {
  /** The button's label. */
  label: string;
  /** What it does, in one line beside the button; when every action has one they stack. */
  consequence?: string;
  /** Posts the action, with the reason when one is given. */
  post: (reason: string | undefined) => Promise<unknown>;
}

/**
 * One button per action, sharing an optional reason field, with a refusal shown below them. On
 * success every Decision query is refetched, since a change may flag other Decisions. Actions that
 * each say what they do stack, one per line with the consequence under its button.
 */
export function Actions({ home, actions }: { home: string; actions: readonly Action[] }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const id = useId();
  const act = useMutation({
    mutationFn: ({ action, reason }: { action: Action; reason: string | undefined }) =>
      action.post(reason),
    onSuccess: () => {
      setReason("");
      for (const queryKey of queriesShowing("decision", home)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
  const stacked = actions.length > 0 && actions.every((action) => action.consequence);
  return (
    <>
      <form
        className={stacked ? styles.stacked : appStyles.actions}
        onSubmit={(event) => event.preventDefault()}
      >
        <label className={styles.reason}>
          Reason (optional){" "}
          <input value={reason} onChange={(event) => setReason(event.target.value)} size={30} />
        </label>
        {actions.map((action, index) => {
          const button = (
            <button
              key={action.label}
              type="button"
              // The first move is the likeliest; the rest are outlined.
              className={stacked && index > 0 ? "secondary" : undefined}
              disabled={act.isPending}
              aria-describedby={stacked ? `${id}-${index}` : undefined}
              onClick={() => act.mutate({ action, reason: reason.trim() || undefined })}
            >
              {action.label}
            </button>
          );
          if (!stacked) return button;
          return (
            <div key={action.label} className={styles.move}>
              {button}
              <span id={`${id}-${index}`} className={styles.consequence}>
                {action.consequence}
              </span>
            </div>
          );
        })}
      </form>
      {act.isError && (
        <p role="alert" className={appStyles.error}>
          {act.error.message}
        </p>
      )}
    </>
  );
}
