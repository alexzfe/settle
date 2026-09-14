import { useParams } from "react-router";
import styles from "./App.module.css";
import { formatLogValue, formatTime, sentence, words } from "./format";
import { useChangeLog } from "./queries";

/** Every change to the Home's record, newest first: read-only, for audit. Undo comes later. */
export function ChangeLogPage() {
  const { home = "" } = useParams();
  const log = useChangeLog(home);
  return (
    <>
      <h1>Change log</h1>
      {log.isPending ? (
        <p>Loading…</p>
      ) : log.isError ? (
        <p className={styles.error}>{log.error.message}</p>
      ) : log.data.changes.length === 0 ? (
        <p>No changes yet.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Origin</th>
                <th>Record</th>
                <th>Field</th>
                <th>Old</th>
                <th>New</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {log.data.changes.map((change, index) => (
                // Log rows have no id and hold no state, so their position is key enough.
                <tr key={index}>
                  <td>{formatTime(change.at)}</td>
                  <td>{change.origin === "web" ? "Web UI" : <code>{change.origin}</code>}</td>
                  <td>
                    {sentence(change.recordKind)} <code>{change.record}</code>
                  </td>
                  <td>{change.field ? words(change.field) : <em>created</em>}</td>
                  <td>{formatLogValue(change.old)}</td>
                  <td>{formatLogValue(change.new)}</td>
                  <td>{change.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
