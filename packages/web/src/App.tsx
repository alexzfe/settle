import { type ReactNode, useEffect, useId, useLayoutEffect, useState } from "react";
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
import { DECISION_STATES, STATE_LABEL } from "./decisions";
import { FindButton, FindProvider } from "./find/Find";
import { HomeListPage } from "./HomeListPage";
import { HomePage } from "./HomePage";
import { ItemPage } from "./ItemPage";
import { ItemsPage } from "./ItemsPage";
import { type LiveState, useLiveUpdates } from "./liveUpdates";
import { useDecisions, useHomes, useItems, useShopping } from "./queries";
import { RoomPage } from "./RoomPage";
import { RoomsPage } from "./RoomsPage";
import { SessionPage } from "./SessionPage";
import { ShoppingPage } from "./ShoppingPage";
import { useScrollToHash } from "./scrollToHash";
import { AgentStatus } from "./ui/AgentStatus";
import { documentTitle, HomeNameContext } from "./ui/documentTitle";
import { SettleMark } from "./ui/SettleIcon";
import { StateMark } from "./ui/StateMark";
import { ThemeToggle } from "./ui/ThemeToggle";

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      {
        path: "/",
        element: (
          <Shell>
            <HomeListPage />
          </Shell>
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
          { path: "items/:item", element: <ItemPage /> },
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
      <Outlet />
    </FindProvider>
  );
}

/** What the sidebar shows of the Home on screen: its sections, counts, and live connection. */
interface ShellHome {
  slug: string;
  name: string;
  section: string;
  live: LiveState;
}

/**
 * The app's frame: a sidebar beside the page, which below about 760px folds into a slim top bar
 * whose menu button opens the same sidebar as a sheet. Outside a Home (the Home list) the sidebar
 * has only the mark and the theme switch.
 */
function Shell({ home, children }: { home?: ShellHome; children: ReactNode }) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const sheet = useId();
  const { pathname } = useLocation();
  // Following a link in the sheet closes it.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className={styles.shell}>
      {narrow && (
        <header className={styles.topBar}>
          <Link to="/" className={styles.topMark} aria-label="All Homes">
            <span aria-hidden="true" className={styles.lockupMark}>
              <SettleMark size={22} />
            </span>
          </Link>
          <span className={styles.topName}>{home?.name}</span>
          <FindButton compact />
          <button
            type="button"
            className={`secondary ${styles.menuButton}`}
            aria-expanded={open}
            aria-controls={sheet}
            onClick={() => setOpen(!open)}
          >
            <MenuIcon />
            Menu
          </button>
        </header>
      )}
      {narrow && open && (
        // A pointer convenience: Escape and the menu button close the sheet for the keyboard.
        // biome-ignore lint/a11y/noStaticElementInteractions: see above.
        // biome-ignore lint/a11y/useKeyWithClickEvents: see above.
        <div className={styles.scrim} onClick={() => setOpen(false)} />
      )}
      <aside id={sheet} className={styles.sidebar} data-open={(narrow && open) || undefined}>
        <Link to="/" className={styles.lockup}>
          <span aria-hidden="true" className={styles.lockupMark}>
            <SettleMark size={22} />
          </span>
          settle
        </Link>
        {home && <HomeSidebar home={home} />}
        <div className={styles.footer}>
          <ThemeToggle />
          {home && <AgentStatus home={home.slug} live={home.live} />}
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

/** Below this width the sidebar folds into the top bar; App.module.css uses the same one. */
export const NARROW_QUERY = "(max-width: 759.98px)";

/** Whether the window is phone-narrow, following resizes. False where matchMedia is missing. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => mediaQuery()?.matches ?? false);
  useEffect(() => {
    const query = mediaQuery();
    if (!query) return;
    const onChange = () => setNarrow(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

function mediaQuery(): MediaQueryList | undefined {
  return typeof window.matchMedia === "function" ? window.matchMedia(NARROW_QUERY) : undefined;
}

function MenuIcon() {
  return (
    <svg className={styles.menuIcon} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M3 5.5h14M3 10h14M3 14.5h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * How many of each thing wants the user, as the nav shows them: undefined until loaded. The
 * Decisions are asked for as the Decisions list asks (Archived included), so the two share one
 * request, and Archived ones are left out here.
 */
function useNavCounts(home: string): Record<string, number | undefined> {
  const decisions = useDecisions(home, { archived: true });
  const shopping = useShopping(home);
  const items = useItems(home, false);
  return {
    Decisions: decisions.data?.decisions.filter(
      (decision) =>
        !decision.archivedAt && (decision.state === "candidate" || decision.state === "leaning"),
    ).length,
    Shopping: shopping.data?.shoppingList.length,
    Inventory: items.data?.items.length,
  };
}

/** The sidebar's part for one Home: the switcher, Find, the nav, and the state key. */
function HomeSidebar({ home }: { home: ShellHome }) {
  const base = `/homes/${home.slug}`;
  const counts = useNavCounts(home.slug);
  const links: [string, string][] = [
    ["Overview", base],
    ["Rooms", `${base}/rooms`],
    ["Decisions", `${base}/decisions`],
    ["Shopping", `${base}/shopping`],
    ["Inventory", `${base}/items`],
    ["Change log", `${base}/log`],
    ["About", `${base}/about`],
  ];
  return (
    <>
      <HomeSwitcher />
      <FindButton />
      <nav className={styles.sideNav} aria-label="Home">
        {links.map(([label, to]) => {
          const current = home.section === label;
          const count = counts[label];
          return (
            <Link
              key={label}
              to={to}
              className={current ? styles.current : undefined}
              aria-current={current ? "page" : undefined}
            >
              <span>{label}</span>
              {/* Shown, not spoken: the link keeps the section's name. */}
              {count !== undefined && (
                <span className={styles.count} aria-hidden="true">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className={styles.stateKey}>
        <p className="label">States</p>
        <ul>
          {DECISION_STATES.map((state) => (
            <li key={state}>
              <span aria-hidden="true">
                <StateMark state={state} />
              </span>
              {STATE_LABEL[state]}
            </li>
          ))}
        </ul>
      </div>
    </>
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
      return "Inventory";
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
  return (
    <HomeNameContext.Provider value={name}>
      <Shell home={{ slug: home, name, section, live }}>
        <Outlet />
      </Shell>
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
      <span className="label">Home</span>
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
