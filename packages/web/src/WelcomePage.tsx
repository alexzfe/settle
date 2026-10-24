// The first run, after an invite or the setup link made the Account and while it has no Home:
// "Name your Home", then "Connect Settle to Claude", then the Home. Someone with a Home is sent
// to the Home list instead; the Account page keeps the Connect block for later.

import { useRef } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import styles from "./App.module.css";
import { ConnectToClaude } from "./ConnectToClaude";
import { CreateHomeForm } from "./CreateHomeForm";
import list from "./HomeListPage.module.css";
import { useHome, useHomes } from "./queries";
import { Card } from "./ui/Card";

/** Step 1: the Home's name, country and city. */
export function NameYourHome() {
  const homes = useHomes();
  const navigate = useNavigate();
  // The Home just made refetches the list, which may land before the move to step 2 does.
  const created = useRef(false);
  if (homes.isPending) return <p>Loading…</p>;
  if (homes.isError) return <p className={styles.error}>{homes.error.message}</p>;
  if (homes.data.homes.length > 0 && !created.current) return <Navigate to="/" replace />;
  return (
    <>
      <p className={styles.muted}>Step 1 of 2</p>
      <h1>Name your Home</h1>
      <p>
        The place you're furnishing. Its city tells Settle where the sun comes from; nothing else
        about it is needed yet.
      </p>
      <Card className={list.create}>
        <CreateHomeForm
          onCreated={(home) => {
            created.current = true;
            void navigate(`/welcome/connect/${home}`);
          }}
        />
      </Card>
    </>
  );
}

/** Step 2: the Connect to Claude block, then on to the Home. */
export function ConnectStep() {
  const slug = useParams().home ?? "";
  const home = useHome(slug);
  const name = home.data?.home.name;
  return (
    <>
      <p className={styles.muted}>Step 2 of 2</p>
      <h1>Connect Settle to Claude</h1>
      <p>
        You'll plan {name ?? "your Home"} by talking to Claude. Connect it once, and every chat can
        use Settle.
      </p>
      <ConnectToClaude />
      <p>
        <Link to={`/homes/${slug}`}>{name ? `Go to ${name}` : "Go to your Home"}</Link>
        <span className={styles.muted}>
          {" "}
          · You can connect later from <Link to="/account">your account</Link>.
        </span>
      </p>
    </>
  );
}
