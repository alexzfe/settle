// Connecting Claude to the Account: the Connect to Claude block, which the first run and the
// Account page share, and the Account page's list of Connections, each with Disconnect.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import page from "./AccountPage.module.css";
import styles from "./App.module.css";
import { call } from "./api";
import connect from "./ConnectToClaude.module.css";
import { formatDate } from "./format";
import { queryKeys } from "./queries";
import { CopyButton } from "./ui/AskAgent";

/**
 * The button that opens Claude's "Add custom connector" dialog with Settle filled in, and, for
 * Claude Code, the one command that adds the same connector and the plugin. Both come from the
 * server, which names its own address.
 */
export function ConnectToClaude() {
  const setup = useQuery({
    queryKey: queryKeys.claudeConnect,
    queryFn: () => call("claude_connect", {}),
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (setup.isPending) return <p>Loading…</p>;
  if (setup.isError) {
    return (
      <p role="alert" className={styles.error}>
        {setup.error.message}
      </p>
    );
  }
  const { addConnectorUrl, claudeCodeCommand, mcpUrl } = setup.data;
  return (
    <div className={connect.block}>
      <p>
        <a className={connect.button} href={addConnectorUrl} target="_blank" rel="noopener">
          Connect Settle to Claude
        </a>
      </p>
      <p className={styles.muted}>
        Claude opens with Settle filled in. Click <strong>Add</strong>, then{" "}
        <strong>Connect</strong>, then <strong>Allow</strong>. It works on the web, the desktop and
        phone apps, and in Claude Code, on any Claude plan.
      </p>
      <details className={connect.code}>
        <summary>Using Claude Code in a terminal?</summary>
        <p>Paste this once. It adds Settle for every folder, with the Settle plugin:</p>
        <pre>
          <code>{claudeCodeCommand}</code>
        </pre>
        <CopyButton text={claudeCodeCommand} label="Copy the command" />
        <p className={styles.muted}>
          Then run <code>claude</code> anywhere and log in to Settle when it asks. The address it
          connects to is <code>{mcpUrl}</code>.
        </p>
      </details>
    </div>
  );
}

/** The Account's Connections: who, since when, last used when, and a Disconnect for each. */
export function Connections() {
  const queryClient = useQueryClient();
  const connections = useQuery({
    queryKey: queryKeys.connections,
    queryFn: () => call("list_connections", {}),
  });
  const end = useMutation({
    mutationFn: (connection: number) => call("end_connection", { connection }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.connections }),
  });
  if (connections.isPending) return <p>Loading…</p>;
  if (connections.isError) return <p className={styles.error}>{connections.error.message}</p>;
  const all = connections.data.connections;
  if (all.length === 0) {
    return <p className={styles.muted}>Claude isn't connected to your account yet.</p>;
  }
  return (
    <>
      <ul className={page.list}>
        {all.map((each) => (
          <li key={each.id}>
            <span className={page.agent}>{clientName(each.client)}</span>
            <span className={page.when}>
              Connected {formatDate(each.createdAt)}, last used {dayWords(each.lastUsedAt)}
            </span>
            <button
              type="button"
              className="secondary"
              disabled={end.isPending}
              onClick={() => end.mutate(each.id)}
            >
              Disconnect
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.muted}>
        Disconnect ends it at once. A Connection unused for 90 days ends by itself; connecting again
        is one click.
      </p>
      {end.isError && (
        <p role="alert" className={styles.error}>
          {end.error.message}
        </p>
      )}
    </>
  );
}

/** A Connection's client as the Allow page named it, in words: "Claude (claude.ai)". */
export function clientName(host: string): string {
  if (host === "claude.ai" || host.endsWith(".claude.ai")) return `Claude (${host})`;
  if (host === "localhost" || host === "127.0.0.1") return "A program on a computer (localhost)";
  return host;
}

/** "today", "yesterday", or the date: when a Connection was last used. */
export function dayWords(at: string, now: Date = new Date()): string {
  const date = new Date(at);
  const day = (of: Date) => new Date(of.getFullYear(), of.getMonth(), of.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return formatDate(at, now);
}
