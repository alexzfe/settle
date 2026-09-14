import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import styles from "./App.module.css";
import { queriesShowing } from "./liveUpdates";

export interface Action {
  /** The button's label. */
  label: string;
  /** Posts the action, with the reason when one is given. */
  post: (reason: string | undefined) => Promise<unknown>;
}

/**
 * One button per action, sharing an optional reason field, with a refusal shown below them. On
 * success every Decision query is refetched, since a change may flag other Decisions.
 */
export function Actions({ home, actions }: { home: string; actions: readonly Action[] }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
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
  return (
    <>
      <form className={styles.actions} onSubmit={(event) => event.preventDefault()}>
        <label>
          Reason (optional){" "}
          <input value={reason} onChange={(event) => setReason(event.target.value)} size={30} />
        </label>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={act.isPending}
            onClick={() => act.mutate({ action, reason: reason.trim() || undefined })}
          >
            {action.label}
          </button>
        ))}
      </form>
      {act.isError && (
        <p role="alert" className={styles.error}>
          {act.error.message}
        </p>
      )}
    </>
  );
}
