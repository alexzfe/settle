import { useQuery } from "@tanstack/react-query";
import { fetchHealth } from "./api";
import styles from "./HealthPage.module.css";

export function HealthPage() {
  return (
    <main className={styles.page}>
      <h1>Interior Design Harness</h1>
      <p>
        Server: <ServerStatus />
      </p>
    </main>
  );
}

function ServerStatus() {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  if (health.isPending) return <span>checking…</span>;
  if (health.isError) return <span className={styles.error}>{health.error.message}</span>;
  return <span>{health.data.status}</span>;
}
