import { useLayoutEffect } from "react";
import {
  Link,
  Outlet,
  type RouteObject,
  useLocation,
  useMatch,
  useNavigate,
  useParams,
} from "react-router";
import { AboutPage } from "./AboutPage";
import styles from "./App.module.css";
import { BlueprintPage } from "./BlueprintPage";
import { ChangeLogPage } from "./ChangeLogPage";
import { DecisionPage } from "./DecisionPage";
import { DecisionsPage } from "./DecisionsPage";
import { FindButton, FindProvider } from "./find/Find";
import { HomeListPage } from "./HomeListPage";
import { HomePage } from "./HomePage";
import { ItemsPage } from "./ItemsPage";
import { useLiveUpdates } from "./liveUpdates";
import { useHomes } from "./queries";
import { RoomPage } from "./RoomPage";
import { RoomsPage } from "./RoomsPage";
import { SessionPage } from "./SessionPage";
import { ShoppingPage } from "./ShoppingPage";
import { useScrollToHash } from "./scrollToHash";
import { documentTitle, HomeNameContext } from "./ui/documentTitle";
import { LivePill } from "./ui/LivePill";
import { ThemeToggle } from "./ui/ThemeToggle";

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      {
        path: "/",
        element: (
          <div className={styles.content}>
            <HomeListPage />
          </div>
        ),
      },
      {
        path: "/homes/:home",
        element: <HomeLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "about", element: <AboutPage /> },
          { path: "rooms", element: <RoomsPage /> },
          { path: "rooms/:room", element: <RoomPage /> },
          { path: "decisions", element: <DecisionsPage /> },
          { path: "decisions/:decision", element: <DecisionPage /> },
          { path: "blueprints/:blueprint/:page", element: <BlueprintPage /> },
          { path: "shopping", element: <ShoppingPage /> },
          { path: "items", element: <ItemsPage /> },
          { path: "log", element: <ChangeLogPage /> },
          { path: "sessions/:session", element: <SessionPage /> },
        ],
      },
    ],
  },
];

function Layout() {
  const home = useMatch({ path: "/homes/:home", end: false })?.params.home;
  return (
    <FindProvider home={home}>
      <div className={styles.page}>
        <header className={styles.header}>
          <Link to="/" className={styles.wordmark}>
            Settle
          </Link>
          <FindButton />
          <HomeSwitcher />
          <ThemeToggle />
        </header>
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </FindProvider>
  );
}

function HomeLayout() {
  const { home = "" } = useParams();
  // Keyed by Home, so switching Homes starts every page, form, and action result afresh.
  return <HomeScope key={home} home={home} />;
}

/** The section each path of a Home is in, as the nav and the tab title name it. */
function sectionOf(path: string): string {
  const [, section] = /^\/homes\/[^/]+\/?([^/]*)/.exec(path) ?? [];
  switch (section) {
    case "":
    case undefined:
      return "Overview";
    case "rooms":
      return "Rooms";
    case "decisions":
      return "Decisions";
    case "shopping":
      return "Shopping";
    case "items":
      return "Items";
    case "log":
    case "sessions":
      return "Change log";
    case "about":
      return "About";
    case "blueprints":
      return "Blueprint";
    default:
      return "";
  }
}

/** The pages of one Home, kept live while any of them is open. */
function HomeScope({ home }: { home: string }) {
  const live = useLiveUpdates(home);
  useScrollToHash();
  const homes = useHomes();
  const name = homes.data?.homes.find((each) => each.slug === home)?.name ?? home;
  const { pathname } = useLocation();
  const section = sectionOf(pathname);
  // A layout effect runs before the pages' effects, so a page's useDocumentTitle refines this.
  useLayoutEffect(() => {
    document.title = documentTitle(section === "Overview" ? undefined : section, name);
  }, [section, name]);
  const base = `/homes/${home}`;
  const links: [string, string][] = [
    ["Overview", base],
    ["Rooms", `${base}/rooms`],
    ["Decisions", `${base}/decisions`],
    ["Shopping", `${base}/shopping`],
    ["Items", `${base}/items`],
    ["Change log", `${base}/log`],
    ["About", `${base}/about`],
  ];
  return (
    <HomeNameContext.Provider value={name}>
      <div className={styles.navBar}>
        <nav className={styles.nav} aria-label="Home">
          {links.map(([label, to]) => (
            <Link
              key={label}
              to={to}
              className={section === label ? styles.current : undefined}
              aria-current={section === label ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <LivePill state={live} />
      </div>
      <div className={styles.content}>
        <Outlet />
      </div>
    </HomeNameContext.Provider>
  );
}

/** Chooses which Home the UI shows. It changes nothing else: the Agent's Home is its folder's. */
function HomeSwitcher() {
  const homes = useHomes();
  const shown = useMatch({ path: "/homes/:home", end: false })?.params.home ?? "";
  const navigate = useNavigate();
  return (
    <label className={styles.switcher}>
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
