import { Link, useParams } from "react-router";
import { Actions } from "./Actions";
import styles from "./App.module.css";
import {
  type BasisEntry,
  type Conflict,
  call,
  type DecisionDetail,
  type EvidenceEntry,
  type Flag,
} from "./api";
import {
  automaticBasisNote,
  decisionPath,
  KIND_LABEL,
  MOVES,
  RESOLUTION_LABEL,
  STATE_LABEL,
} from "./decisions";
import { FlagCause, flagActions } from "./Flags";
import { formatDate, sentence, wallName, words } from "./format";
import { PurchaseParts } from "./Purchase";
import { useDecision } from "./queries";
import { Swatch, SwatchSquare } from "./Swatch";
import { Fact, Parts } from "./Values";

const EVIDENCE_KIND: Record<EvidenceEntry["kind"], string> = {
  note: "Note",
  session: "Session",
  decision: "Decision",
};

/** One Decision in full, with the state changes the server allows from its state. */
export function DecisionPage() {
  const { home = "", decision: slug = "" } = useParams();
  const decision = useDecision(home, slug);
  if (decision.isPending) return <p>Loading…</p>;
  if (decision.isError) return <p className={styles.error}>{decision.error.message}</p>;
  return <DecisionSheet home={home} decision={decision.data.decision} />;
}

function DecisionSheet({ home, decision }: { home: string; decision: DecisionDetail }) {
  const moves = MOVES[decision.state].map((move) => ({
    label: move.label,
    post: (reason: string | undefined) =>
      call("set_decision_state", {
        home,
        decision: decision.slug,
        to: move.to,
        ...(reason ? { reason } : {}),
      }),
  }));
  return (
    <>
      <h1>{decision.title}</h1>
      <dl className={styles.facts}>
        <Fact term="Kind">{KIND_LABEL[decision.kind]}</Fact>
        <Fact term="Scope">
          {decision.room ? (
            <Link to={`/homes/${home}/rooms/${decision.room.slug}`}>{decision.room.name}</Link>
          ) : (
            "Home-wide"
          )}
        </Fact>
        <Fact term="State">{STATE_LABEL[decision.state]}</Fact>
        <Fact term="Fulfilled">{decision.fulfilledAt && formatDate(decision.fulfilledAt)}</Fact>
      </dl>
      <p>{decision.statement}</p>
      <h2>Change its state</h2>
      {/* Keyed by state, so a refusal from before the change does not linger after it. */}
      <Actions key={decision.state} home={home} actions={moves} />
      <Content home={home} decision={decision} />
      <h2>Basis</h2>
      {decision.basis.length === 0 ? (
        <p>None: it rests on no other Decision.</p>
      ) : (
        <ul>
          {decision.basis.map((entry) => (
            <li key={entry.slug}>
              <BasisLine home={home} entry={entry} />
            </li>
          ))}
        </ul>
      )}
      <h2>Evidence</h2>
      {decision.evidence.length === 0 ? (
        <p>None recorded.</p>
      ) : (
        <ul>
          {decision.evidence.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`}>
              <EvidenceLine home={home} entry={entry} />
            </li>
          ))}
        </ul>
      )}
      <h2>Flags</h2>
      {decision.flags.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {decision.flags.map((flag) => (
            <li key={flag.slug}>
              <FlagState home={home} flag={flag} />
              {!flag.clearedAt && (
                <Actions home={home} actions={flagActions(home, decision, flag.slug)} />
              )}
            </li>
          ))}
        </ul>
      )}
      <h2>Conflicts</h2>
      {decision.conflicts.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {decision.conflicts.map((conflict) => (
            <li key={conflict.slug}>
              <ConflictState conflict={conflict} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** What the Decision decides, as its kind records it; an Other Decision has only its statement. */
function Content({ home, decision }: { home: string; decision: DecisionDetail }) {
  switch (decision.kind) {
    case "design-direction": {
      const { content } = decision;
      return (
        <>
          <h2>Direction</h2>
          <dl className={styles.facts}>
            <Fact term="Mood">{content.mood}</Fact>
            <Fact term="Color temperature">
              {content.temperature && sentence(content.temperature)}
            </Fact>
            <Fact term="Contrast">{content.contrast && sentence(content.contrast)}</Fact>
            <Fact term="Key materials">{content.keyMaterials?.join(", ")}</Fact>
            <Fact term="Style references">{content.styleReferences?.join(", ")}</Fact>
            <Fact term="Guiding principles">
              {content.principles?.length ? (
                <ul>
                  {content.principles.map((principle) => (
                    <li key={principle}>{principle}</li>
                  ))}
                </ul>
              ) : undefined}
            </Fact>
          </dl>
        </>
      );
    }
    case "room-direction": {
      const { content } = decision;
      return (
        <>
          <h2>Direction</h2>
          <p>{content.direction}</p>
          {(content.mood || content.contrast) && (
            <dl className={styles.facts}>
              <Fact term="Mood">{content.mood}</Fact>
              <Fact term="Contrast">{content.contrast && sentence(content.contrast)}</Fact>
            </dl>
          )}
        </>
      );
    }
    case "room-use": {
      const done = decision.fulfilment?.roomFunctions;
      return (
        <>
          <h2>Functions</h2>
          <p>{decision.content.functions.map(words).join(", ")}</p>
          {done && <p>Fulfilled as: {done.map(words).join(", ")}</p>}
        </>
      );
    }
    case "palette":
      return (
        <>
          <h2>Colors</h2>
          <ul>
            {decision.content.colors.map((color) => (
              <li key={color.name}>
                <Parts>
                  <Swatch color={color} />
                  {color.note}
                </Parts>
              </li>
            ))}
          </ul>
        </>
      );
    case "room-color": {
      const { content } = decision;
      const palette = decision.basis.find((entry) => entry.kind === "palette");
      const painted = decision.fulfilment?.color;
      return (
        <>
          <h2>Color</h2>
          <dl className={styles.facts}>
            <Fact term="Surface">{sentence(content.surface)}</Fact>
            <Fact term="Wall">{content.wall !== undefined && wallName(content.wall)}</Fact>
            <Fact term="Color">
              {decision.paletteColor ? (
                <Swatch color={decision.paletteColor} />
              ) : (
                <Unresolved
                  name={content.color}
                  why={palette ? `not a color of ${palette.title}` : "no Palette in its Basis"}
                />
              )}
            </Fact>
            <Fact term="Finish">{content.finish}</Fact>
          </dl>
          {painted && (
            <p>
              Fulfilled as: <Swatch color={painted} />
              {decision.fulfilment?.finish && `, ${decision.fulfilment.finish}`}
            </p>
          )}
        </>
      );
    }
    case "purchase":
      return <PurchaseParts home={home} decision={decision} />;
    case "other":
      return null;
  }
}

function BasisLine({ home, entry }: { home: string; entry: BasisEntry }) {
  return (
    <Parts>
      <Link to={decisionPath(home, entry.slug)}>{entry.title}</Link>
      {KIND_LABEL[entry.kind]}
      {STATE_LABEL[entry.state]}
      {entry.fulfilledAt && "Fulfilled"}
      {entry.automatic && automaticBasisNote(entry.kind)}
    </Parts>
  );
}

/** A Room color whose color the Palette in force lacks: its name, the placeholder, and why. */
function Unresolved({ name, why }: { name: string; why: string }) {
  return (
    <span>
      <SwatchSquare />
      {name} <span className={styles.muted}>({why})</span>
    </span>
  );
}

function EvidenceLine({ home, entry }: { home: string; entry: EvidenceEntry }) {
  return (
    <>
      <strong>{sentence(entry.stance)}</strong>: {EVIDENCE_KIND[entry.kind]}{" "}
      {entry.kind === "decision" ? (
        <Link to={decisionPath(home, entry.id)}>{entry.name}</Link>
      ) : (
        entry.name
      )}
      {entry.note && ` (${entry.note})`}
    </>
  );
}

/** ": open", or when and how it was settled: ": cleared 14/09/2026, kept (still right)". */
function settled(at: string | undefined, verb: string, mark: Flag | Conflict): string {
  if (!at) return "open";
  const how = mark.resolution ? `, ${RESOLUTION_LABEL[mark.resolution]}` : "";
  return `${verb} ${formatDate(at)}${how}${mark.reason ? ` (${mark.reason})` : ""}`;
}

function FlagState({ home, flag }: { home: string; flag: Flag }) {
  return (
    <>
      <FlagCause home={home} flag={flag} />, raised {formatDate(flag.raisedAt)}:{" "}
      {settled(flag.clearedAt, "cleared", flag)}
    </>
  );
}

function ConflictState({ conflict }: { conflict: Conflict }) {
  return (
    <>
      {conflict.description}, raised {formatDate(conflict.raisedAt)}:{" "}
      {settled(conflict.resolvedAt, "resolved", conflict)}
    </>
  );
}
