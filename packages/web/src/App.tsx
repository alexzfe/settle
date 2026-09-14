import { Link, Outlet, type RouteObject, useMatch, useNavigate } from "react-router";
import styles from "./App.module.css";
import { HomeListPage } from "./HomeListPage";
import { HomePage } from "./HomePage";
import { useHomes } from "./queries";

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: "/", element: <HomeListPage /> },
      { path: "/homes/:slug", element: <HomePage /> },
    ],
  },
];

function Layout() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/">Interior Design Harness</Link>
        <HomeSwitcher />
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

/** Chooses which Home the UI shows. It changes nothing else: the Agent's Home is its folder's. */
function HomeSwitcher() {
  const homes = useHomes();
  const shown = useMatch("/homes/:slug")?.params.slug ?? "";
  const navigate = useNavigate();
  return (
    <label>
      Home{" "}
      <select
        value={shown}
        onChange={(event) => {
          const slug = event.target.value;
          void navigate(slug ? `/homes/${slug}` : "/");
        }}
      >
        <option value="">All Homes</option>
        {homes.data?.homes.map((home) => (
          <option key={home.slug} value={home.slug}>
            {home.name}
          </option>
        ))}
      </select>
    </label>
  );
}
