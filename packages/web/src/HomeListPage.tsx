import { Link } from "react-router";
import styles from "./App.module.css";
import { CreateHomeForm } from "./CreateHomeForm";
import { useHomes } from "./queries";

export function HomeListPage() {
  return (
    <>
      <h1>Homes</h1>
      <HomeList />
      <h2>Create a Home</h2>
      <CreateHomeForm />
    </>
  );
}

function HomeList() {
  const homes = useHomes();
  if (homes.isPending) return <p>Loading…</p>;
  if (homes.isError) return <p className={styles.error}>{homes.error.message}</p>;
  if (homes.data.homes.length === 0) return <p>No Homes yet.</p>;
  return (
    <ul>
      {homes.data.homes.map((home) => (
        <li key={home.slug}>
          <Link to={`/homes/${home.slug}`}>{home.name}</Link>, {home.city}, {home.country}
        </li>
      ))}
    </ul>
  );
}
