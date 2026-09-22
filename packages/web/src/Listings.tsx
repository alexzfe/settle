// The Listing board: the real products the user has brought to a Purchase, compared side by side.
// A matrix with the Listings across the top and the Requirements down the side, musts first,
// collapsing to one card per Listing on a phone. The head is what you scan — the picture, the
// Rating, the price — and the grid beneath it is the only thing that shows why one Listing beats
// another, so the two stay together.
//
// This is also where Listings got their first web-callable writes (docs/handoff/listing-board.md):
// dropping one, holding one, and setting its picture. Everything else about a Listing is the
// Agent's to write.

import type { Held, HoldReason } from "@settle/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import styles from "./App.module.css";
import {
  call,
  type Listing,
  type ListingCheck,
  listingPhotoUrl,
  type Requirement,
  upload,
} from "./api";
import { useDragScroll } from "./dragScroll";
import { formatDate, metres, sentence } from "./format";
import { queriesShowing } from "./liveUpdates";
import { isSafeLink } from "./Markdown";
import page from "./Purchase.module.css";
import { AgentWritten } from "./ui/AgentWritten";
import { Card } from "./ui/Card";
import { Stars } from "./ui/Stars";
import { Parts } from "./Values";

const RESULT_LABEL: Record<ListingCheck["result"], string> = {
  pass: "Pass",
  fail: "Fail",
  unknown: "Unknown",
};

const RESULT_SYMBOL: Record<ListingCheck["result"], string> = {
  pass: "✓",
  fail: "✕",
  unknown: "?",
};

/**
 * Why a Listing is Held, in the words core prints them in (HOLD_REASON_LABELS, render.ts). They
 * are written out here rather than imported, because importing a *value* from @settle/core pulls
 * core's Node-only modules — mupdf's 10 MB of WebAssembly among them — into the browser bundle.
 * The Record keeps the two in step all the same: a reason added or dropped in core fails this
 * build.
 */
const HOLD_REASON_LABELS: Record<HoldReason, string> = {
  "out-of-stock": "out of stock",
  discontinued: "discontinued",
  "too-expensive-now": "too expensive now",
  other: "another reason",
};

const HOLD_REASONS = Object.keys(HOLD_REASON_LABELS) as HoldReason[];

/** What the paste box takes, and what core will accept: the three types it can sniff. */
const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * How many Listings load their pictures at once. The heads sit well down the page, below the
 * Guides and the Requirements, so a lazy picture there waits to be scrolled to; the first few are
 * the ones the reader is about to see, and the rest wait their turn.
 */
const EAGER_PICTURES = 4;

/** "2 Listings", "1 week". */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long ago, in the coarsest unit still honest about it: "today", "yesterday", "5 days ago",
 * "3 weeks ago", "2 months ago". Stock is the most perishable fact on the board, so a hold reads
 * by its age rather than by a date the reader has to subtract for themselves.
 */
export function ago(at: string, now: Date = new Date()): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return "at an unrecorded time";
  const days = Math.floor((now.getTime() - then.getTime()) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 31) return `${counted(Math.floor(days / 7), "week")} ago`;
  if (days < 365) return `${counted(Math.max(1, Math.round(days / 30)), "month")} ago`;
  return `${counted(Math.floor(days / 365), "year")} ago`;
}

/**
 * Best first: everything that fails no must, then the must-failers, each group by Rating
 * descending with the unrated after the rated, and ties left in the order they were recorded.
 *
 * A Held Listing sorts by its Rating like any other and never sinks. It is "good, not now" — the
 * bar the others are measured against — and sorting it down among the rejects is exactly what
 * would stop it being that. Only a failed must moves a Listing down, because only a failed must
 * means it cannot be bought at all. Nothing else derived from the checks touches the order, and
 * the Rating itself is never capped, dimmed, or recomputed here.
 */
export function byBest(a: Listing, b: Listing): number {
  const failer = (listing: Listing) => (listing.failedMusts.length > 0 ? 1 : 0);
  if (failer(a) !== failer(b)) return failer(a) - failer(b);
  return (b.rating ?? 0) - (a.rating ?? 0);
}

/** The check a Listing has for a Requirement, by position; unknown when it has none. */
function checkFor(listing: Listing, requirement: Requirement): ListingCheck {
  return (
    listing.checks.find((check) => check.requirement === requirement.position) ?? {
      requirement: requirement.position,
      text: requirement.text,
      strength: requirement.strength,
      result: "unknown",
    }
  );
}

/**
 * What leads a Listing: the musts it fails, else the musts not checked, else that it meets every
 * must. Undefined when there are no musts. No overall score: the user weighs the rest.
 */
export function listingVerdict(
  listing: Listing,
  requirements: readonly Requirement[],
): { tone: "fail" | "unknown" | "pass"; text: string } | undefined {
  const musts = requirements.filter((requirement) => requirement.strength === "must");
  if (musts.length === 0) return undefined;
  const checks = musts.map((must) => checkFor(listing, must));
  const failed = checks.filter(
    (check) => check.result === "fail" || listing.failedMusts.includes(check.requirement),
  );
  if (failed.length > 0) {
    const noun = failed.length === 1 ? "a must" : `${failed.length} musts`;
    return { tone: "fail", text: `Fails ${noun}: ${failed.map((c) => c.text).join("; ")}` };
  }
  const unknown = checks.filter((check) => check.result === "unknown" || check.unchecked);
  if (unknown.length > 0) {
    return { tone: "unknown", text: `Must not checked: ${unknown.map((c) => c.text).join("; ")}` };
  }
  return { tone: "pass", text: "Meets every must" };
}

/** Whether the screen is at least `width` wide; wide when the browser cannot say. */
function useWide(width: string): boolean {
  const query = `(min-width: ${width})`;
  const media = () =>
    typeof window.matchMedia === "function" ? window.matchMedia(query) : undefined;
  const [wide, setWide] = useState(() => media()?.matches ?? true);
  useEffect(() => {
    const list = typeof window.matchMedia === "function" ? window.matchMedia(query) : undefined;
    if (!list) return undefined;
    const update = () => setWide(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return wide;
}

/**
 * A write the board makes itself. Every one of them is logged against its Purchase Decision, so
 * on success each query showing a Decision is refetched — the same refresh the change event
 * brings, but without waiting for it to arrive.
 */
function useBoardWrite<Input, Output>(home: string, post: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: post,
    onSuccess: () => {
      for (const queryKey of queriesShowing("decision", home)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

/**
 * The Listings side by side, best first: a matrix with the Listings across the top and the
 * Requirements down the side, musts first, a failed must marked strongly; on a phone, one card
 * per Listing. A wide board scrolls sideways — nothing folds, since folding would hide a
 * must-failer, the one thing the board must always show.
 */
export function ListingComparison({
  home,
  requirements,
  listings,
}: {
  home: string;
  /** Already in display order: musts first. */
  requirements: readonly Requirement[];
  listings: readonly Listing[];
}) {
  const wide = useWide("48rem");
  const drag = useDragScroll<HTMLDivElement>(`.${page.picture}`);
  const shown = listings.toSorted(byBest);
  if (!wide) {
    return (
      <ul className={page.listingCards}>
        {shown.map((listing, index) => (
          <li key={listing.slug}>
            <ListingCard
              home={home}
              listing={listing}
              requirements={requirements}
              eager={index < EAGER_PICTURES}
            />
          </li>
        ))}
      </ul>
    );
  }
  return (
    // Dragged sideways by its ground as well as by the scrollbar, the Requirement column pinned
    // so a cell far to the right still says which Requirement it answers.
    <div
      className={`${styles.scroll} ${page.matrixWrap} ${drag.dragging ? page.dragging : ""}`}
      {...drag.handlers}
    >
      <table className={page.matrix}>
        <thead>
          <tr>
            <th scope="col" className={page.corner}>
              Requirement
            </th>
            {shown.map((listing, index) => (
              <th
                key={listing.slug}
                scope="col"
                className={listing.failedMusts.length > 0 ? page.failedListing : undefined}
              >
                <ListingHead
                  home={home}
                  listing={listing}
                  requirements={requirements}
                  eager={index < EAGER_PICTURES}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {requirements.map((requirement) => (
            <tr key={requirement.position}>
              <th scope="row" className={page.rowHead}>
                <span className={`${page.strength} ${page[requirement.strength]}`}>
                  {sentence(requirement.strength)}
                </span>{" "}
                {requirement.text}
              </th>
              {shown.map((listing) => (
                <CheckCell
                  key={listing.slug}
                  check={checkFor(listing, requirement)}
                  failedMust={listing.failedMusts.includes(requirement.position)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A link to a page elsewhere, opened in a new tab; plain text without a web address. */
function WebLink({ href, children }: { href: string | undefined; children: ReactNode }) {
  if (!href || !isSafeLink(href)) return children;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/** A Listing's size as it states it, "W 2.00 m × D 3.00 m"; undefined when it states none. */
function listingSize(dimensions: Listing["dimensions"]): string | undefined {
  const stated = (
    [
      ["W", dimensions?.width],
      ["D", dimensions?.depth],
      ["H", dimensions?.height],
    ] as const
  ).flatMap(([label, mm]) => (mm === undefined ? [] : [`${label} ${metres(mm)}`]));
  return stated.length === 0 ? undefined : stated.join(" × ");
}

/**
 * What leads a Listing wherever it is shown: its picture above everything, its name (linked to
 * its page), its price, its Rating with the Agent's reason for it, its size and when it was
 * recorded, any hold, the verdict on its musts, and the board's own controls.
 */
function ListingHead({
  home,
  listing,
  requirements,
  eager,
}: {
  home: string;
  listing: Listing;
  requirements: readonly Requirement[];
  /** Whether its picture loads at once rather than when scrolled to. */
  eager: boolean;
}) {
  const verdict = listingVerdict(listing, requirements);
  return (
    <div className={page.listingHead}>
      <ListingPicture home={home} listing={listing} eager={eager} />
      <span className={page.listingName}>
        <WebLink href={listing.url}>{listing.name}</WebLink>
      </span>
      <span className={listing.price ? page.price : `${page.price} ${page.noPrice}`}>
        {listing.price ?? "Price not recorded"}
      </span>
      <Rating listing={listing} />
      <span className={page.listingMeta}>
        <Parts>
          {listingSize(listing.dimensions)}
          {listing.photoUrl && isSafeLink(listing.photoUrl) && (
            <WebLink href={listing.photoUrl}>photo</WebLink>
          )}
          {`recorded ${formatDate(listing.recordedAt)}`}
        </Parts>
      </span>
      {listing.held && <HeldLine held={listing.held} />}
      {verdict && (
        <span className={`${page.verdict} ${page[`verdict-${verdict.tone}`]}`}>
          {verdict.tone === "fail" ? <strong>{verdict.text}</strong> : verdict.text}
        </span>
      )}
      <ListingControls home={home} listing={listing} />
    </div>
  );
}

/**
 * The Rating: five stars with the Agent's one-line reason beneath, in the treatment every other
 * piece of Agent-written text gets. A Listing that fails a must keeps every star it was given and
 * has them drawn hollow — the fail is carried by the verdict line, the marked cells, and the
 * shape of the stars, never by taking stars away. No Rating shows nothing at all, rather than
 * five empty stars, which would read as a Rating of zero.
 */
function Rating({ listing }: { listing: Listing }) {
  if (listing.rating === undefined) return null;
  return (
    <div className={page.rating}>
      <Stars rating={listing.rating} outlined={listing.failedMusts.length > 0} />
      {listing.ratingNote && (
        <AgentWritten>
          <p className={page.ratingNote}>{listing.ratingNote}</p>
        </AgentWritten>
      )}
    </div>
  );
}

/** "Held 3 weeks ago: out of stock (back in March)", with the day it was set behind it. */
function HeldLine({ held }: { held: Held }) {
  return (
    <span className={page.held} title={`Held on ${formatDate(held.at)}`}>
      <strong>Held</strong> {ago(held.at)}: {HOLD_REASON_LABELS[held.reason]}
      {held.note && ` (${held.note})`}
    </span>
  );
}

/**
 * The picture, above everything else: the copy the app holds when it has one, addressed by the
 * version of its bytes so a replacement never comes back out of the browser cache; otherwise the
 * source link hotlinked, which is what the board did before it stored anything; otherwise an
 * empty slot that opens the paste box. The paste box is here at every Listing, not only where a
 * fetch failed — a retailer's own photo is often the worst picture of the thing.
 */
function ListingPicture({
  home,
  listing,
  eager,
}: {
  home: string;
  listing: Listing;
  eager: boolean;
}) {
  const [pasting, setPasting] = useState(false);
  const [broken, setBroken] = useState(false);
  const hotlink = listing.photoUrl && isSafeLink(listing.photoUrl) ? listing.photoUrl : undefined;
  const src =
    listing.photoVersion === undefined
      ? hotlink
      : listingPhotoUrl(home, listing.slug, listing.photoVersion);
  // A new address is a new picture, and deserves its own try even if the last one would not load.
  useEffect(() => setBroken(false), [src]);
  const empty = src === undefined || broken;
  return (
    <div className={page.picture}>
      {empty ? (
        <button
          type="button"
          className={`${page.photo} ${page.photoEmpty}`}
          onClick={() => setPasting(true)}
        >
          No picture yet. Paste or choose one.
        </button>
      ) : (
        <img
          className={page.photo}
          src={src}
          alt={listing.name}
          loading={eager ? "eager" : "lazy"}
          onError={() => setBroken(true)}
        />
      )}
      <div className={page.pictureActions}>
        {listing.photoUrl && listing.photoVersion === undefined && (
          <FetchPicture home={home} listing={listing.slug} url={listing.photoUrl} />
        )}
        <button
          type="button"
          className={`secondary ${page.pictureButton}`}
          aria-expanded={pasting}
          onClick={() => setPasting(!pasting)}
        >
          {empty ? "Add a picture" : "Change the picture"}
        </button>
      </div>
      {pasting && <PasteBox home={home} listing={listing.slug} onDone={() => setPasting(false)} />}
    </div>
  );
}

/**
 * Stores a copy of the picture a Listing links to, in one click, for the Listings recorded before
 * the app kept its own copies and any whose fetch failed once. Core fetches it exactly as it would
 * an address typed into the paste box, and refuses it in the same words.
 */
function FetchPicture({ home, listing, url }: { home: string; listing: string; url: string }) {
  const send = useBoardWrite(home, (form: FormData) => upload("set_listing_photo", form));
  function fetchIt() {
    const form = new FormData();
    form.append("home", home);
    form.append("listing", listing);
    form.append("url", url);
    send.mutate(form);
  }
  return (
    <>
      <button
        type="button"
        className={`secondary ${page.pictureButton}`}
        disabled={send.isPending}
        onClick={fetchIt}
      >
        {send.isPending ? "Fetching…" : "Fetch the picture"}
      </button>
      <Refusal of={send} />
    </>
  );
}

/**
 * Sets one Listing's picture: an image pasted from the clipboard, dropped or chosen as a file, or
 * an image URL for the app to fetch. Core refuses what is not an image, or what is too big, and
 * unlike the fetch it makes on its own that refusal is shown — the user is standing here waiting
 * on it.
 */
function PasteBox({
  home,
  listing,
  onDone,
}: {
  home: string;
  listing: string;
  onDone: () => void;
}) {
  const [url, setUrl] = useState("");
  const [over, setOver] = useState(false);
  // A paste goes to whatever has focus, so the target takes it as the box opens.
  const target = useRef<HTMLButtonElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  useEffect(() => target.current?.focus(), []);
  const send = useBoardWrite(home, (form: FormData) => upload("set_listing_photo", form));

  function post(field: "file" | "url", value: File | string) {
    const form = new FormData();
    form.append("home", home);
    form.append("listing", listing);
    form.append(field, value);
    send.mutate(form, {
      onSuccess: () => {
        setUrl("");
        onDone();
      },
    });
  }

  function sendFirst(files: FileList | null | undefined) {
    const file = files?.[0];
    if (file) post("file", file);
  }

  function onPaste(event: ClipboardEvent<HTMLButtonElement>) {
    if (event.clipboardData.files.length === 0) return;
    event.preventDefault();
    sendFirst(event.clipboardData.files);
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setOver(false);
    sendFirst(event.dataTransfer.files);
  }

  function onChoose(event: ChangeEvent<HTMLInputElement>) {
    sendFirst(event.target.files);
  }

  return (
    <div className={page.pasteBox}>
      {/* The target is a button so that it takes focus, and a paste with it, on its own terms. */}
      <button
        ref={target}
        type="button"
        className={over ? `${page.pasteTarget} ${page.pasteOver}` : page.pasteTarget}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onClick={() => chooser.current?.click()}
      >
        {send.isPending ? "Sending…" : "Paste an image here, drop one in, or choose a file"}
      </button>
      <input
        ref={chooser}
        type="file"
        accept={PHOTO_ACCEPT}
        className={page.chooser}
        onChange={onChoose}
        aria-label="Picture file"
      />
      <label className={page.pasteUrl}>
        Or the address of an image{" "}
        <input
          type="url"
          value={url}
          placeholder="https://…/rug.jpg"
          size={24}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={url.trim() === "" || send.isPending}
          onClick={() => post("url", url.trim())}
        >
          {send.isPending ? "Fetching…" : "Fetch it"}
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
      {send.isError && (
        <p role="alert" className={styles.error}>
          {send.error.message}
        </p>
      )}
    </div>
  );
}

/** Holding a Listing, releasing it, and dropping it: the three writes the board makes itself. */
function ListingControls({ home, listing }: { home: string; listing: Listing }) {
  return (
    <div className={page.listingControls}>
      <HoldControl home={home} listing={listing} />
      <DropControl home={home} listing={listing} />
    </div>
  );
}

/**
 * Holds a Listing with a reason from the fixed list and a few words of note, or releases one.
 * The list stays short and countable; "another reason" plus the note is what shows the list what
 * it is missing when it is next revised from real use.
 */
function HoldControl({ home, listing }: { home: string; listing: Listing }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<HoldReason>("out-of-stock");
  const [note, setNote] = useState("");
  const hold = useBoardWrite(home, (held: { reason: HoldReason; note?: string } | null) =>
    call("hold_listing", { home, listing: listing.slug, held }),
  );

  if (listing.held) {
    return (
      <>
        <button
          type="button"
          className="secondary"
          disabled={hold.isPending}
          onClick={() => hold.mutate(null)}
        >
          Release
        </button>
        <Refusal of={hold} />
      </>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        className="secondary"
        aria-expanded={false}
        onClick={() => setOpen(true)}
      >
        Hold
      </button>
    );
  }
  return (
    <div className={page.holdForm}>
      <label>
        Why{" "}
        <select value={reason} onChange={(event) => setReason(event.target.value as HoldReason)}>
          {HOLD_REASONS.map((each) => (
            <option key={each} value={each}>
              {sentence(HOLD_REASON_LABELS[each])}
            </option>
          ))}
        </select>
      </label>
      <label>
        Note (optional){" "}
        <input
          value={note}
          size={18}
          placeholder="back in March"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={hold.isPending}
          onClick={() =>
            hold.mutate(
              { reason, ...(note.trim() ? { note: note.trim() } : {}) },
              { onSuccess: () => setOpen(false) },
            )
          }
        >
          Hold it
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <Refusal of={hold} />
    </div>
  );
}

/**
 * Drops a Listing. No reason is asked for: a reason field belongs to a decision with consequences
 * — Reopen, Reject, Settle — and asking for one here would only teach the user to ignore it. It is
 * permanent and takes the picture with it, so it asks once, in the page.
 */
function DropControl({ home, listing }: { home: string; listing: Listing }) {
  const [armed, setArmed] = useState(false);
  const drop = useBoardWrite(home, () => call("drop_listing", { home, listing: listing.slug }));
  if (!armed) {
    return (
      <button type="button" className="secondary" onClick={() => setArmed(true)}>
        Drop
      </button>
    );
  }
  return (
    <div className={page.dropConfirm}>
      <span className={page.dropWarning}>
        Drops {listing.name}, its checks, and its picture, for good.
      </span>
      <div className={styles.actions}>
        <button type="button" disabled={drop.isPending} onClick={() => drop.mutate(undefined)}>
          Drop it
        </button>
        <button type="button" className="secondary" onClick={() => setArmed(false)}>
          Keep it
        </button>
      </div>
      <Refusal of={drop} />
    </div>
  );
}

/** A refusal from one of the board's writes, in the reader's words, where it happened. */
function Refusal({ of }: { of: { isError: boolean; error: Error | null } }) {
  if (!of.isError) return null;
  return (
    <p role="alert" className={styles.error}>
      {of.error?.message}
    </p>
  );
}

function resultOf(check: ListingCheck): { label: string; result: ListingCheck["result"] } {
  return check.unchecked
    ? { label: "Unknown: added after it was checked", result: "unknown" }
    : { label: RESULT_LABEL[check.result], result: check.result };
}

function CheckCell({ check, failedMust }: { check: ListingCheck; failedMust: boolean }) {
  const { label, result } = resultOf(check);
  return (
    <td className={`${page.cell} ${page[result]} ${failedMust ? page.failedMust : ""}`}>
      <span className={page.result}>
        <span aria-hidden>{RESULT_SYMBOL[result]}</span>{" "}
        {failedMust ? <strong>{label}</strong> : label}
      </span>
      {check.note && <span className={page.note}>{check.note}</span>}
    </td>
  );
}

/** A Listing on a phone: the same head, then each Requirement's result, musts first. */
function ListingCard({
  home,
  listing,
  requirements,
  eager,
}: {
  home: string;
  listing: Listing;
  requirements: readonly Requirement[];
  eager: boolean;
}) {
  return (
    <Card className={listing.failedMusts.length > 0 ? page.failedCard : undefined}>
      <ListingHead home={home} listing={listing} requirements={requirements} eager={eager} />
      <ul className={page.cardChecks}>
        {requirements.map((requirement) => {
          const check = checkFor(listing, requirement);
          const failedMust = listing.failedMusts.includes(requirement.position);
          const { label, result } = resultOf(check);
          return (
            <li
              key={requirement.position}
              className={`${page[result]} ${failedMust ? page.failedMust : ""}`}
            >
              <span className={page.result}>
                <span aria-hidden>{RESULT_SYMBOL[result]}</span>{" "}
                {failedMust ? <strong>{label}</strong> : label}
              </span>
              <span>
                {sentence(requirement.strength)}: {requirement.text}
                {check.note && <span className={page.note}> · {check.note}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
