import {
  Link,
  NavLink,
  Outlet,
  type RouteObject,
  useMatch,
  useNavigate,
  useParams,
} from "react-router";
import styles from "./App.module.css";
import { BlueprintPage } from "./BlueprintPage";
import { ChangeLogPage } from "./ChangeLogPage";
import { HomeListPage } from "./HomeListPage";
import { HomePage } from "./HomePage";
import { ItemsPage } from "./ItemsPage";
import { useLiveUpdates } from "./liveUpdates";
import { useHomes } from "./queries";
import { RoomPage } from "./RoomPage";

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: "/", element: <HomeListPage /> },
      {
        path: "/homes/:home",
        element: <HomeLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "rooms/:room", element: <RoomPage /> },
          { path: "blueprints/:blueprint/:page", element: <BlueprintPage /> },
          { path: "items", element: <ItemsPage /> },
          { path: "log", element: <ChangeLogPage /> },
        ],
      },
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

function HomeLayout() {
  const { home = "" } = useParams();
  // Keyed by Home, so switching Homes starts every page, form, and action result afresh.
  return <HomeScope key={home} home={home} />;
}

/** The pages of one Home, kept live while any of them is open. */
function HomeScope({ home }: { home: string }) {
  useLiveUpdates(home);
  return (
    <>
      <nav className={styles.nav}>
        <NavLink to={`/homes/${home}`} end>
          Home
        </NavLink>
        <NavLink to={`/homes/${home}/items`}>Items</NavLink>
        <NavLink to={`/homes/${home}/log`}>Change log</NavLink>
      </nav>
      <Outlet />
    </>
  );
}

/** Chooses which Home the UI shows. It changes nothing else: the Agent's Home is its folder's. */
function HomeSwitcher() {
  const homes = useHomes();
  const shown = useMatch({ path: "/homes/:home", end: false })?.params.home ?? "";
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
