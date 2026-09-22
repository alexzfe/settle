// Every Home as a card, and the form that creates one.

import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router";
import styles from "./App.module.css";
import { call } from "./api";
import { CreateHomeForm } from "./CreateHomeForm";
import list from "./HomeListPage.module.css";
import { queryKeys, useHomes } from "./queries";
import { Card } from "./ui/Card";
import { Section } from "./ui/Section";

export function HomeListPage() {
  return (
    <>
      <h1>Homes</h1>
      <HomeList />
      <Section title="Create a Home">
        <Card className={list.create}>
          <CreateHomeForm />
        </Card>
      </Section>
    </>
  );
}

function HomeList() {
  const homes = useHomes();
  const all = homes.data?.homes ?? [];
  // Each Home's Rooms, for the count on its card.
  const details = useQueries({
    queries: all.map((home) => ({
      queryKey: queryKeys.home(home.slug),
      queryFn: () => call("get_home", { home: home.slug }),
    })),
  });
  if (homes.isPending) return <p>Loading…</p>;
  if (homes.isError) return <p className={styles.error}>{homes.error.message}</p>;
  if (all.length === 0) return <p className={styles.muted}>No Homes yet.</p>;
  return (
    <ul className={list.cards}>
      {all.map((home, index) => {
        const rooms = details[index]?.data?.rooms.length;
        return (
          <li key={home.slug} className={list.card}>
            <Link to={`/homes/${home.slug}`} className={`clamp ${list.name}`}>
              {home.name}
            </Link>
            <span className={list.place}>
              {home.city}, {home.country}
            </span>
            {rooms !== undefined && (
              <span className={list.rooms}>
                {rooms} {rooms === 1 ? "Room" : "Rooms"}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
