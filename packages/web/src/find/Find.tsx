// The find box: type, the results narrow on every keystroke, Enter jumps there. It only jumps; it
// changes nothing. One overlay serves the whole Home, opened by / or Ctrl-K (⌘K on a Mac), the
// Find row in the sidebar or its icon in the phone's top bar, and the box on the Home page. It has no URL of its own, but opening it adds a history entry to
// the page it covers, so the browser's back button (or a phone's swipe back) closes it rather than
// leaving the page.

import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { FindRow } from "../api";
import { inertAround } from "../focus";
import { useFindIndex } from "../queries";
import styles from "./Find.module.css";
import { find } from "./match";

/** How many results show before the "n more" line. */
export const SHOWN = 8;

interface Finder {
  open: () => void;
}

const FinderContext = createContext<Finder | undefined>(undefined);

/** The history state that marks the entry opening the box added. */
interface FindingState {
  finding: true;
}

function isFinding(state: unknown): state is FindingState {
  return typeof state === "object" && state !== null && "finding" in state;
}

/** Keeps the find box for `home`, when a Home is shown, with its shortcuts; renders `children`. */
export function FindProvider({ home, children }: { home?: string; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  // Opened from this page load: a reload on the box's history entry shows the page, not the box.
  const [opened, setOpened] = useState(false);
  const isOpen = Boolean(home) && opened && isFinding(location.state);
  const { pathname, search, hash } = location;
  const open = useCallback(() => {
    if (isOpen) return;
    setOpened(true);
    void navigate({ pathname, search, hash }, { state: { finding: true } satisfies FindingState });
  }, [isOpen, navigate, pathname, search, hash]);
  const finder = useMemo(() => (home ? { open } : undefined), [home, open]);

  useEffect(() => {
    if (!home) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      const ctrlK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      const slash = event.key === "/" && !event.ctrlKey && !event.metaKey;
      if (ctrlK || (slash && !typingIn(event.target))) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [home, open]);

  return (
    <FinderContext.Provider value={finder}>
      {children}
      {isOpen && home && (
        <FindOverlay
          home={home}
          onClose={() => void navigate(-1)}
          onGo={(path) => void navigate(path, { replace: true })}
        />
      )}
    </FinderContext.Provider>
  );
}

/** Whether a key pressed on `target` is typing into a field, where / is just a slash. */
function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/** The shortcut as this computer writes it: ⌘K on a Mac or an iPad, Ctrl K elsewhere. */
export function shortcutLabel(platform = navigatorPlatform()): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘K" : "Ctrl K";
}

function navigatorPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return data?.platform || navigator.platform || navigator.userAgent;
}

/**
 * The way into the find box: the sidebar's Find row with its shortcuts, or, `compact`, the phone's
 * top-bar icon, since a phone has no keyboard shortcut. Nothing outside a Home.
 */
export function FindButton({ compact = false }: { compact?: boolean }) {
  const finder = useContext(FinderContext);
  if (!finder) return null;
  const shortcut = shortcutLabel();
  if (compact) {
    return (
      <button
        type="button"
        className={`secondary ${styles.iconButton}`}
        aria-label="Find in this Home"
        onClick={finder.open}
      >
        <SearchIcon />
      </button>
    );
  }
  return (
    <button
      type="button"
      className={styles.row}
      aria-label="Find in this Home"
      title={`Find in this Home (${shortcut} or /)`}
      onClick={finder.open}
    >
      <SearchIcon />
      <span className={styles.rowText}>Find</span>
      <span className={styles.keys} aria-hidden="true">
        <kbd className={styles.kbd}>{shortcut}</kbd>
        <kbd className={styles.kbd}>/</kbd>
      </span>
    </button>
  );
}

/** Which result has the keyboard: a row, or the side link at its right end. */
interface Active {
  row: number;
  side: boolean;
}

function FindOverlay({
  home,
  onClose,
  onGo,
}: {
  home: string;
  onClose: () => void;
  onGo: (path: string) => void;
}) {
  const index = useFindIndex(home);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState<Active>({ row: 0, side: false });
  const input = useRef<HTMLInputElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const id = useId();
  const results = useMemo(() => find(index.data?.rows ?? [], query), [index.data, query]);
  const shown = expanded ? results : results.slice(0, SHOWN);
  const current = shown[active.row];
  const listed = !index.isPending && !index.isError && results.length > 0;
  const targetId =
    listed && current ? `${id}-${active.row}${active.side ? "-side" : ""}` : undefined;
  // The latest onClose, for the document's Escape listener.
  const close = useRef(onClose);
  close.current = onClose;

  // The page behind stays still and inert while the box is open, so Tab and a screen reader stay
  // in the box, and it gets its focus back when the box closes.
  useEffect(() => {
    const before = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const madeInert = backdrop.current ? inertAround(backdrop.current) : [];
    input.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      for (const element of madeInert) element.removeAttribute("inert");
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  // Escape closes the box wherever focus is, even after a click left it on the page body.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (targetId) document.getElementById(targetId)?.scrollIntoView?.({ block: "nearest" });
  }, [targetId]);

  const onKeyDown = (event: KeyboardEvent) => {
    const move = (row: number) => {
      if (row >= SHOWN) setExpanded(true);
      setActive({ row, side: false });
    };
    const caretAtEnd = input.current?.selectionStart === query.length;
    // Keys pressed elsewhere in the panel are their own: Enter on "n more" or Close is that
    // button's. Escape is the document's, above.
    if (event.target !== input.current) return;
    switch (event.key) {
      case "ArrowDown":
        if (active.row < results.length - 1) move(active.row + 1);
        break;
      case "ArrowUp":
        if (active.row > 0) move(active.row - 1);
        break;
      case "ArrowRight":
        if (!current?.also || active.side || !caretAtEnd) return;
        setActive({ row: active.row, side: true });
        break;
      case "ArrowLeft":
        if (!active.side) return;
        setActive({ row: active.row, side: false });
        break;
      case "Enter": {
        const path = active.side ? current?.also?.path : current?.path;
        if (path) onGo(path);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    // The backdrop is a pointer convenience: Escape and back close the box for the keyboard.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above.
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above.
    <div
      ref={backdrop}
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Find in this Home"
        className={styles.panel}
        onKeyDown={onKeyDown}
      >
        <div className={styles.field}>
          <SearchIcon />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-label="Find"
            aria-expanded={listed}
            aria-controls={listed ? `${id}-results` : undefined}
            aria-activedescendant={targetId}
            aria-autocomplete="list"
            placeholder="Find a Room, Decision, Item…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setExpanded(false);
              setActive({ row: 0, side: false });
            }}
          />
          {/* "Close" on a phone, which has no Escape key; the key's own name on a wider screen. The
              name holds both words, so a speech user can say either one they see. */}
          <button
            type="button"
            className={`secondary ${styles.close}`}
            aria-label="Close (Esc)"
            onClick={onClose}
          >
            <span className={styles.closeWord}>Close</span>
            <kbd className={styles.closeKey}>Esc</kbd>
          </button>
        </div>
        {index.isPending ? (
          <p className={styles.note}>Loading…</p>
        ) : index.isError ? (
          <p className={styles.note}>{index.error.message}</p>
        ) : results.length === 0 ? (
          <p className={styles.note}>
            {query.trim() ? "Nothing here is named like that." : "Type a name to find it."}
          </p>
        ) : (
          // A list of results that is also a listbox, so the field's highlighted option is read out.
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: see above.
          <ul id={`${id}-results`} role="listbox" className={styles.results} aria-label="Results">
            {shown.map((row, at) => (
              <Result
                key={`${row.kind}/${row.slug}`}
                row={row}
                id={`${id}-${at}`}
                active={active.row === at ? (active.side ? "side" : "row") : undefined}
              />
            ))}
          </ul>
        )}
        {results.length > shown.length && (
          <button type="button" className={styles.more} onClick={() => setExpanded(true)}>
            {results.length - shown.length} more
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * One result: its name, where it is, its type, and its state when it has one, then the one side
 * link at the right end. The row's own link stops short of the side link, so a thumb aiming at
 * one never opens the other.
 */
function Result({ row, id, active }: { row: FindRow; id: string; active?: "row" | "side" }) {
  return (
    // Each link is an option of the listbox, so the field's highlighted result is announced as
    // the arrows move; the row itself is only layout.
    <li role="none" className={row.retired ? `${styles.result} ${styles.retired}` : styles.result}>
      <Link
        id={id}
        role="option"
        aria-selected={active === "row"}
        to={row.path}
        replace
        className={styles.main}
        data-active={active === "row" || undefined}
      >
        <span className={styles.name}>{row.name}</span>
        <span className={styles.meta}>
          {row.where && <span className={styles.where}>{row.where}</span>}
          <span className={styles.chip}>{row.label}</span>
          {row.state && <span className={styles.state}>{row.state}</span>}
        </span>
      </Link>
      {row.also && (
        <Link
          id={`${id}-side`}
          role="option"
          aria-selected={active === "side"}
          to={row.also.path}
          replace
          className={styles.side}
          aria-label={`${row.also.label}: ${row.name}`}
          title={row.also.label}
          data-active={active === "side" || undefined}
        >
          <GuideIcon />
          <span className={styles.sideText}>{row.also.label}</span>
        </Link>
      )}
    </li>
  );
}

function SearchIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12.6 12.6 17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** A short checklist: the Quick Guide is a list read in the shop. */
function GuideIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M3.5 5.5l1.2 1.2 2-2.2M3.5 10.5l1.2 1.2 2-2.2M9 5.8h7.5M9 10.8h7.5M9 15.3h7.5M4 15.3h1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
