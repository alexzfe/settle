// The Admin page: invites for new Accounts, reset links for forgotten passwords, and every Account
// seen from outside, by its email, dates and Home count, to disable or delete. Nothing here opens
// another Account's Homes.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import page from "./AccountPage.module.css";
import styles from "./App.module.css";
import { call } from "./api";
import { formatDate, formatTime } from "./format";
import { queryKeys, useAccount } from "./queries";
import { CopyButton } from "./ui/AskAgent";
import { Dialog } from "./ui/Dialog";
import { Section } from "./ui/Section";

export function AdminPage() {
  const account = useAccount();
  if (account.isPending) return <p>Loading…</p>;
  if (account.isError) return <p className={styles.error}>{account.error.message}</p>;
  if (!account.data.account.admin) {
    return <p className={styles.muted}>Only the Admin, who runs this server, sees this page.</p>;
  }
  return (
    <>
      <h1>Admin</h1>
      <p className={styles.muted}>
        You run this server. You can let people in and out, but not into their Homes. Settle sends
        no email: send each link yourself.
      </p>
      <Section title="Invites">
        <Invites />
      </Section>
      <Section title="Accounts">
        <Accounts />
      </Section>
    </>
  );
}

/** A link just made, shown once, since only its fingerprint is kept: to copy, with its expiry. */
function MadeLink({ url, expiresAt, what }: { url: string; expiresAt: string; what: string }) {
  return (
    <div className={page.made} role="status">
      <p>
        Send this {what} to them. It works once, until {formatTime(expiresAt)}, and is shown only
        now.
      </p>
      <code>{url}</code>
      <CopyButton text={url} label="Copy the link" />
    </div>
  );
}

function Invites() {
  const queryClient = useQueryClient();
  const invites = useQuery({
    queryKey: queryKeys.invites,
    queryFn: () => call("list_invites", {}),
  });
  const make = useMutation({
    mutationFn: () => call("create_invite", {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.invites }),
  });
  const cancel = useMutation({
    mutationFn: (invite: number) => call("cancel_invite", { invite }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.invites }),
  });
  return (
    <>
      <p>An invite lets one person make an account, once, within 7 days.</p>
      <button type="button" disabled={make.isPending} onClick={() => make.mutate()}>
        Make an invite
      </button>
      {make.isSuccess && <MadeLink {...make.data.invite} what="invite" />}
      {invites.isError && <p className={styles.error}>{invites.error.message}</p>}
      {invites.data && invites.data.invites.length > 0 && (
        <>
          <h3>Waiting to be used</h3>
          <ul className={page.list}>
            {invites.data.invites.map((invite) => (
              <li key={invite.id}>
                <span>
                  Made {formatDate(invite.createdAt)}, works until {formatTime(invite.expiresAt)}
                </span>
                <button
                  type="button"
                  className="secondary"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(invite.id)}
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {[make, cancel].map(
        (each, index) =>
          each.isError && (
            <p key={index} role="alert" className={styles.error}>
              {each.error.message}
            </p>
          ),
      )}
    </>
  );
}

function Accounts() {
  const queryClient = useQueryClient();
  const accounts = useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => call("list_accounts", {}),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
  const reset = useMutation({
    mutationFn: (account: number) => call("create_reset_link", { account }),
  });
  const disable = useMutation({
    mutationFn: (account: number) => call("disable_account", { account }),
    onSuccess: refresh,
  });
  const enable = useMutation({
    mutationFn: (account: number) => call("enable_account", { account }),
    onSuccess: refresh,
  });
  const [deleting, setDeleting] = useState<{ id: number; email: string }>();
  if (accounts.isPending) return <p>Loading…</p>;
  if (accounts.isError) return <p className={styles.error}>{accounts.error.message}</p>;
  return (
    <>
      <div className={styles.scroll}>
        <table className={page.table}>
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Made</th>
              <th scope="col">Homes</th>
              <th scope="col">
                <span className={page.visuallyHidden}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.data.accounts.map((account) => (
              <tr key={account.id}>
                <td>
                  {account.email}{" "}
                  {account.disabledAt && <span className={styles.tag}>Disabled</span>}
                </td>
                <td>{formatDate(account.createdAt)}</td>
                <td>{account.homes}</td>
                <td>
                  {account.admin ? (
                    <span className={styles.muted}>You</span>
                  ) : (
                    <div className={page.rowActions}>
                      <button
                        type="button"
                        className="secondary"
                        disabled={reset.isPending}
                        onClick={() => reset.mutate(account.id)}
                      >
                        Reset link
                      </button>
                      {account.disabledAt ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={enable.isPending}
                          onClick={() => enable.mutate(account.id)}
                        >
                          Enable
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="secondary"
                          disabled={disable.isPending}
                          onClick={() => disable.mutate(account.id)}
                        >
                          Disable
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setDeleting({ id: account.id, email: account.email })}
                      >
                        Delete…
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted}>
        Disabling logs an account out at once and stops its Homes' Agent keys and Quick Guide links,
        keeping everything; enabling it again undoes that.
      </p>
      {reset.isSuccess && (
        <MadeLink
          {...reset.data.reset}
          what={`reset link for ${accounts.data.accounts.find((each) => each.id === reset.variables)?.email}`}
        />
      )}
      {[reset, disable, enable].map(
        (each, index) =>
          each.isError && (
            <p key={index} role="alert" className={styles.error}>
              {each.error.message}
            </p>
          ),
      )}
      {deleting && (
        <DeleteAccount
          account={deleting}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            setDeleting(undefined);
            refresh();
          }}
        />
      )}
    </>
  );
}

function DeleteAccount({
  account,
  onClose,
  onDeleted,
}: {
  account: { id: number; email: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const remove = useMutation({
    mutationFn: (email: string) => call("admin_delete_account", { account: account.id, email }),
    onSuccess: onDeleted,
  });
  return (
    <Dialog label={`Delete ${account.email}`} onClose={onClose}>
      <form
        className={`${styles.form} ${page.form}`}
        onSubmit={(event) => {
          event.preventDefault();
          remove.mutate(String(new FormData(event.currentTarget).get("email") ?? ""));
        }}
      >
        <h2>Delete {account.email}?</h2>
        <p>
          Their account, every Home in it, and every file they uploaded are deleted for good. To
          stop them for now and keep everything, disable the account instead. They can download
          everything from their Account page first.
        </p>
        <label>
          Type their email to delete it{" "}
          <input name="email" type="email" autoComplete="off" required />
        </label>
        <div className={page.actions}>
          <button type="submit" disabled={remove.isPending}>
            Delete the account
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Keep it
          </button>
        </div>
        {remove.isError && (
          <p role="alert" className={styles.error}>
            {remove.error.message}
          </p>
        )}
      </form>
    </Dialog>
  );
}
