// The Account page: the Account logged in, its email and password, Claude connected to it, the
// browsers logged in to it, everything in it to download, and deleting it.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import page from "./AccountPage.module.css";
import styles from "./App.module.css";
import { ACCOUNT_EXPORT_URL, call, login } from "./api";
import { Connections, ConnectToClaude } from "./ConnectToClaude";
import { formatDate, formatTime } from "./format";
import { queryKeys, useAccount } from "./queries";
import { Card } from "./ui/Card";
import { Dialog } from "./ui/Dialog";
import { Section } from "./ui/Section";

export function AccountPage() {
  const account = useAccount();
  if (account.isPending) return <p>Loading…</p>;
  if (account.isError) return <p className={styles.error}>{account.error.message}</p>;
  const { email, admin, createdAt, password, google } = account.data.account;
  return (
    <>
      <h1>Your account</h1>
      <p className={styles.muted}>
        {email}
        {admin && ", the Admin of this server"}. Made {formatDate(createdAt)}.
        {google && " You can log in with Google."}
      </p>
      <div className={page.columns}>
        <div>
          <Section title="Email">
            <Card>
              {password ? (
                <EmailForm email={email} />
              ) : (
                <p className={styles.muted}>
                  Your email is what you log in with. To change it, set a password first: changing
                  it asks for one.
                </p>
              )}
            </Card>
          </Section>
          <Section title="Password">
            <Card>
              <PasswordForm hasPassword={password} />
            </Card>
          </Section>
        </div>
        <div>
          <Section title="Connect to Claude">
            <ConnectToClaude />
          </Section>
          <Section title="Connections">
            <Connections />
          </Section>
          <Section title="Logins">
            <Logins />
          </Section>
          <Section title="Take it with you">
            <p>
              Everything in your Homes, as one <code>.zip</code>: every record, as JSON, and every
              file you uploaded.
            </p>
            <a href={ACCOUNT_EXPORT_URL} download>
              Download everything
            </a>
          </Section>
          {!admin && (
            <Section title="Delete your account">
              <DeleteAccount email={email} />
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

function EmailForm({ email }: { email: string }) {
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (input: { email: string; password: string }) => call("change_email", input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.account }),
  });
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    change.mutate(
      { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") },
      { onSuccess: () => element.reset() },
    );
  }
  return (
    <form className={`${styles.form} ${page.form}`} onSubmit={onSubmit}>
      <p className={styles.muted}>
        Your email is what you log in with. Nothing is ever sent to it.
      </p>
      <label>
        New email <input name="email" type="email" defaultValue={email} required />
      </label>
      <label>
        Your password{" "}
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit" disabled={change.isPending}>
        Change email
      </button>
      {change.isSuccess && <p role="status">Your email is now {change.data.account.email}.</p>}
      {change.isError && (
        <p role="alert" className={styles.error}>
          {change.error.message}
        </p>
      )}
    </form>
  );
}

/** Change the password; or, for an Account made with Google, set its first one. */
function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const queryClient = useQueryClient();
  const [mismatch, setMismatch] = useState(false);
  const change = useMutation({
    mutationFn: (input: { current?: string; password: string }) => call("change_password", input),
    // The Account too: one that had no password now has one.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.account }),
  });
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const password = String(form.get("password") ?? "");
    setMismatch(password !== String(form.get("again") ?? ""));
    if (password !== String(form.get("again") ?? "")) return;
    change.mutate(
      hasPassword ? { current: String(form.get("current") ?? ""), password } : { password },
      { onSuccess: () => element.reset() },
    );
  }
  return (
    <form className={`${styles.form} ${page.form}`} onSubmit={onSubmit}>
      {!hasPassword && (
        <p className={styles.muted}>
          You log in with Google, so your account has no password. Set one to log in with your email
          too.
        </p>
      )}
      <p className={styles.muted}>
        At least 12 characters; a few words in a row is fine. Every other browser logged in to your
        account is logged out.
      </p>
      {hasPassword && (
        <label>
          Current password{" "}
          <input name="current" type="password" autoComplete="current-password" required />
        </label>
      )}
      <label>
        New password{" "}
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
        />
      </label>
      <label>
        The same again <input name="again" type="password" autoComplete="new-password" required />
      </label>
      <button type="submit" disabled={change.isPending}>
        {hasPassword ? "Change password" : "Set a password"}
      </button>
      {mismatch && (
        <p role="alert" className={styles.error}>
          The two new passwords are different. Type the same one twice.
        </p>
      )}
      {change.isSuccess && (
        <p role="status">
          {change.variables.current === undefined ? "Password set." : "Password changed."} Other
          browsers are logged out.
        </p>
      )}
      {change.isError && (
        <p role="alert" className={styles.error}>
          {change.error.message}
        </p>
      )}
    </form>
  );
}

/** The browsers logged in to the Account, and a way to log every one of them out. */
function Logins() {
  const logins = useQuery({ queryKey: queryKeys.logins, queryFn: () => call("list_logins", {}) });
  const end = useMutation({
    mutationFn: () => call("end_logins", {}),
    // This browser was logged out too.
    onSuccess: () => login.go(),
  });
  if (logins.isPending) return <p>Loading…</p>;
  if (logins.isError) return <p className={styles.error}>{logins.error.message}</p>;
  return (
    <>
      <ul className={page.list}>
        {logins.data.logins.map((each) => (
          <li key={each.id}>
            <span className={page.agent}>{browserName(each.userAgent)}</span>
            {each.current && <span className={styles.tag}>This browser</span>}
            <span className={page.when}>
              Logged in {formatDate(each.createdAt)}, last seen {formatTime(each.lastSeenAt)}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="secondary"
        disabled={end.isPending}
        onClick={() => end.mutate()}
      >
        Log out everywhere
      </button>
      <p>This disconnects Claude too.</p>
      {end.isError && (
        <p role="alert" className={styles.error}>
          {end.error.message}
        </p>
      )}
    </>
  );
}

/** A browser as its user agent names it, in a few words: "Firefox on Linux". */
export function browserName(userAgent: string | undefined): string {
  if (!userAgent) return "A browser";
  const browser =
    [
      ["Edg/", "Edge"],
      ["Firefox/", "Firefox"],
      ["Chrome/", "Chrome"],
      ["Safari/", "Safari"],
      ["curl/", "curl"],
    ].find(([mark]) => userAgent.includes(mark as string))?.[1] ?? "A browser";
  const system = [
    ["iPhone", "iPhone"],
    ["iPad", "iPad"],
    ["Android", "Android"],
    ["Mac OS X", "macOS"],
    ["Windows", "Windows"],
    ["Linux", "Linux"],
  ].find(([mark]) => userAgent.includes(mark as string))?.[1];
  return system ? `${browser} on ${system}` : browser;
}

/** Deleting the Account, for good: it asks for the email, and points to the download first. */
function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: (typed: string) => call("delete_account", { email: typed }),
    onSuccess: () => login.go(),
  });
  return (
    <>
      <p>
        Deletes your account, every Home in it, and every file you uploaded, for good. Nobody can
        bring it back.
      </p>
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        Delete my account…
      </button>
      {open && (
        <Dialog label="Delete your account" onClose={() => setOpen(false)}>
          <form
            className={`${styles.form} ${page.form}`}
            onSubmit={(event) => {
              event.preventDefault();
              remove.mutate(String(new FormData(event.currentTarget).get("email") ?? ""));
            }}
          >
            <h2>Delete your account?</h2>
            <p>
              First, <a href={ACCOUNT_EXPORT_URL}>download everything</a>: once it is deleted, your
              Homes, their Photos and Documents are gone.
            </p>
            <label>
              Type your email, {email}, to delete it{" "}
              <input name="email" type="email" autoComplete="off" required />
            </label>
            <div className={page.actions}>
              <button type="submit" disabled={remove.isPending}>
                Delete my account
              </button>
              <button type="button" className="secondary" onClick={() => setOpen(false)}>
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
      )}
    </>
  );
}
