import type { DesignDirectionContent } from "@settle/core";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Actions, StateLadder } from "./Actions";
import styles from "./App.module.css";
import {
  type BasisEntry,
  type Conflict,
  call,
  type DecisionDetail,
  type EvidenceEntry,
  type Flag,
} from "./api";
import page from "./DecisionPage.module.css";
import {
  automaticBasisNote,
  decisionPath,
  KIND_LABEL,
  KIND_SKILL,
  MOVES,
  RESOLUTION_LABEL,
  STATE_LABEL,
} from "./decisions";
import { FlagCause, FlagDot, flagActions } from "./Flags";
import { formatDate, sentence, wallName, words } from "./format";
import { isSafeLink } from "./Markdown";
import { PurchaseBoard, PurchaseParts, QuickGuideSection } from "./Purchase";
import { useDecision } from "./queries";
import { LrvBar, PaletteChips, Swatch, SwatchSquare } from "./Swatch";
import { AgentWritten } from "./ui/AgentWritten";
import { AskAgent, buildPrompt } from "./ui/AskAgent";
import { Card } from "./ui/Card";
import { useDocumentTitle } from "./ui/documentTitle";
import { Section } from "./ui/Section";
import { StateMark } from "./ui/StateMark";
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
  useDocumentTitle(decision.data?.decision.title);
  if (decision.isPending) return <p>Loading…</p>;
  if (decision.isError) return <p className={styles.error}>{decision.error.message}</p>;
  return <DecisionSheet home={home} decision={decision.data.decision} />;
}

function DecisionSheet({ home, decision }: { home: string; decision: DecisionDetail }) {
  const skill = KIND_SKILL[decision.kind];
  const openFlags = decision.flags.filter((flag) => !flag.clearedAt).length;
  const purchase = decision.kind === "purchase";
  // A Settled Purchase still to be bought leads with its Quick Guide: in a shop that is the page.
  const guideFirst = purchase && decision.state === "settled" && !decision.fulfilledAt;
  // What it rests on and what is wrong with it: under the Content, or for a Purchase, under its
  // Listing board.
  const records = (
    <>
      <Section title="Basis" id="basis">
        {decision.basis.length === 0 ? (
          <p className={styles.muted}>None: it rests on no other Decision.</p>
        ) : (
          <ul className={page.chips}>
            {decision.basis.map((entry) => (
              <li key={entry.slug}>
                <BasisChip home={home} entry={entry} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Evidence" id="evidence">
        {decision.evidence.length === 0 ? (
          <p className={styles.muted}>None recorded.</p>
        ) : (
          <ul className={page.evidence}>
            {decision.evidence.map((entry) => (
              <li key={`${entry.kind}:${entry.id}`}>
                <EvidenceLine home={home} entry={entry} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Flags" id="flags">
        {decision.flags.length === 0 ? (
          <p className={styles.muted}>None.</p>
        ) : (
          <ul className={page.marksList}>
            {decision.flags.map((flag) => (
              <li key={flag.slug} className={flag.clearedAt ? page.settled : page.open}>
                <FlagState home={home} flag={flag} />
                {!flag.clearedAt && (
                  <Actions home={home} actions={flagActions(home, decision, flag.slug)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Conflicts" id="conflicts">
        {decision.conflicts.length === 0 ? (
          <p className={styles.muted}>None.</p>
        ) : (
          <ul className={page.marksList}>
            {decision.conflicts.map((conflict) => (
              <li key={conflict.slug} className={conflict.resolvedAt ? page.settled : page.open}>
                <ConflictState conflict={conflict} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
  return (
    <article className={page.sheet}>
      <header className={page.header}>
        <p className={page.eyebrow}>
          {KIND_LABEL[decision.kind]} ·{" "}
          {decision.room ? (
            <Link to={`/homes/${home}/rooms/${decision.room.slug}`}>{decision.room.name}</Link>
          ) : (
            "Home-wide"
          )}
        </p>
        <h1 className={page.title}>{decision.title}</h1>
        <p className={page.marks}>
          <span className={page.stateName}>
            <StateMark state={decision.state} />
            {STATE_LABEL[decision.state]}
          </span>
          {decision.fulfilledAt && (
            <span className={page.fulfilled}>
              <span aria-hidden>✓</span> Fulfilled {formatDate(decision.fulfilledAt)}
            </span>
          )}
          {openFlags > 0 && (
            <FlagDot>
              <a href="#flags">
                {openFlags === 1 ? "Needs review" : `${openFlags} flags need review`}
              </a>
            </FlagDot>
          )}
        </p>
      </header>
      <div className={page.layout}>
        <div className={page.main}>
          {guideFirst && <QuickGuideSection home={home} decision={decision} />}
          {decision.statement && (
            <AgentWritten source={skill && `${skill} Session`} date={decision.createdAt}>
              <p>{decision.statement}</p>
            </AgentWritten>
          )}
          <Content home={home} decision={decision} withQuickGuide={!guideFirst} />
          {!purchase && records}
        </div>
        <aside className={page.side} aria-label="Change it">
          <Card>
            <h2 className={page.sideTitle}>State</h2>
            {/* Keyed by state, so a refusal from before the change does not linger after it. */}
            <StateLadder
              key={decision.state}
              home={home}
              state={decision.state}
              moves={MOVES[decision.state]}
              post={(to) => call("set_decision_state", { home, decision: decision.slug, to })}
            />
          </Card>
          <Card className={page.ask}>
            <p className={page.askText}>Not sure? Talk it over with the Agent.</p>
            <AskAgent
              label="Talk this Decision through"
              prompt={buildPrompt({
                skill,
                text: `let's talk through the Decision "${decision.title}"`,
                slug: decision.slug,
              })}
            />
          </Card>
        </aside>
      </div>
      {purchase && (
        <>
          <PurchaseBoard home={home} decision={decision} />
          <div className={page.after}>{records}</div>
        </>
      )}
    </article>
  );
}

/** What the Decision decides, as its kind records it; an Other Decision has only its statement. */
function Content({
  home,
  decision,
  withQuickGuide,
}: {
  home: string;
  decision: DecisionDetail;
  withQuickGuide: boolean;
}) {
  switch (decision.kind) {
    case "design-direction":
      return (
        <Section title="Direction">
          <Moodboard content={decision.content} />
        </Section>
      );
    case "room-direction": {
      const { content } = decision;
      return (
        <Section title="Direction">
          {/* The Agent's prose: the serif at reading size, under the statement's one label. */}
          <p className="agentProse">{content.direction}</p>
          {(content.mood || content.contrast) && (
            <dl className={styles.facts}>
              <Fact term="Mood">{content.mood}</Fact>
              <Fact term="Contrast">{content.contrast && sentence(content.contrast)}</Fact>
            </dl>
          )}
        </Section>
      );
    }
    case "room-use": {
      const done = decision.fulfilment?.roomFunctions;
      return (
        <Section title="Functions">
          <ul className={page.pills}>
            {decision.content.functions.map((each) => (
              <li key={each} className={page.pill}>
                {sentence(words(each))}
              </li>
            ))}
          </ul>
          {done && <p>Fulfilled as: {done.map(words).join(", ")}</p>}
        </Section>
      );
    }
    case "palette":
      return (
        <Section title="Colors">
          <PaletteChips colors={decision.content.colors} />
          <ul className={page.applications} aria-label="Where each color goes">
            {decision.content.colors.map((color, index) => (
              // Two colors may share a name, so the position keeps keys apart.
              <li key={`${index}-${color.name}`}>
                <span className={page.applicationName}>
                  <SwatchSquare hex={color.hex} name={color.name} />
                  {color.name}
                </span>
                <span className={page.applicationNote}>
                  {sentence(color.role)}
                  {color.note ? ` · ${color.note}` : ""}
                </span>
                {color.lrv !== undefined && <LrvBar lrv={color.lrv} />}
              </li>
            ))}
          </ul>
        </Section>
      );
    case "room-color": {
      const { content } = decision;
      const palette = decision.basis.find((entry) => entry.kind === "palette");
      const painted = decision.fulfilment?.color;
      return (
        <Section title="Color">
          {decision.paletteColor ? (
            <div className={page.roomColor}>
              <PaletteChips colors={[decision.paletteColor]} />
              {decision.paletteColor.lrv !== undefined && (
                <LrvBar lrv={decision.paletteColor.lrv} />
              )}
            </div>
          ) : (
            <p>
              <Unresolved
                name={content.color}
                why={palette ? `not a color of ${palette.title}` : "no Palette in its Basis"}
              />
            </p>
          )}
          <dl className={styles.facts}>
            <Fact term="Surface">{sentence(content.surface)}</Fact>
            <Fact term="Wall">{content.wall !== undefined && wallName(content.wall)}</Fact>
            <Fact term="Finish">{content.finish}</Fact>
          </dl>
          {painted && (
            <p>
              Fulfilled as: <Swatch color={painted} />
              {decision.fulfilment?.finish && `, ${decision.fulfilment.finish}`}
            </p>
          )}
        </Section>
      );
    }
    case "purchase":
      return <PurchaseParts home={home} decision={decision} withQuickGuide={withQuickGuide} />;
    case "other":
      return null;
  }
}

export type Texture = "oak" | "linen" | "terracotta" | "brass" | "stone" | "neutral";

const TEXTURE_WORDS: [Texture, RegExp][] = [
  ["oak", /\b(oak|wood|walnut|ash|beech|pine|teak|timber|elm|birch|cherry|bamboo|rattan|cane)/i],
  ["linen", /\b(linen|cotton|wool|boucl|jute|sisal|hemp|fabric|textile|cashmere|felt)/i],
  ["terracotta", /\b(terracotta|terra cotta|clay|brick|ceramic|tile|earthenware|cork|leather)/i],
  ["brass", /\b(brass|bronze|gold|copper|metal|steel|iron|chrome|nickel|aluminium)/i],
  ["stone", /\b(stone|marble|travertine|limestone|slate|granite|concrete|plaster|terrazzo)/i],
];

/** Which small texture a key material's pill shows, by the words in it; neutral otherwise. */
export function materialTexture(material: string): Texture {
  return TEXTURE_WORDS.find(([, pattern]) => pattern.test(material))?.[0] ?? "neutral";
}

const TEMPERATURE_AT: Record<NonNullable<DesignDirectionContent["temperature"]>, number> = {
  warm: 12,
  neutral: 50,
  cool: 88,
};

/**
 * The Design Direction as a moodboard: the mood as a pull quote, key materials as textured pills,
 * color temperature on a warm-to-cool bar, contrast as a pair of squares, the guiding principles
 * numbered, style references as links, and a place kept for photos.
 */
function Moodboard({ content }: { content: DesignDirectionContent }) {
  const { mood, temperature, contrast, keyMaterials, styleReferences, principles } = content;
  return (
    <div className={page.moodboard}>
      {mood && (
        <figure className={page.mood}>
          <p>{mood}</p>
          <figcaption>Mood</figcaption>
        </figure>
      )}
      {keyMaterials && keyMaterials.length > 0 && (
        <Tile title="Key materials">
          <ul className={page.pills}>
            {keyMaterials.map((material) => (
              <li key={material} className={page.pill}>
                <span
                  className={`${page.texture} ${page[`texture-${materialTexture(material)}`]}`}
                  aria-hidden
                />
                {material}
              </li>
            ))}
          </ul>
        </Tile>
      )}
      {temperature && (
        <Tile title="Color temperature">
          <span className={page.temperature}>
            <span
              className={page.temperatureBar}
              role="img"
              aria-label={`${sentence(temperature)}, on a scale from warm to cool`}
            >
              <span
                className={page.temperatureMarker}
                style={{ left: `${TEMPERATURE_AT[temperature]}%` }}
              />
            </span>
            <span className={page.scaleEnds} aria-hidden>
              <span>Warm</span>
              <span>Cool</span>
            </span>
            <strong>{sentence(temperature)}</strong>
          </span>
        </Tile>
      )}
      {contrast && (
        <Tile title="Contrast">
          <span className={page.contrast}>
            <span
              className={`${page.contrastPair} ${page[`contrast-${contrast}`]}`}
              role="img"
              aria-label={`${sentence(contrast)} contrast`}
            >
              <span />
              <span />
            </span>
            <strong>{sentence(contrast)}</strong>
          </span>
        </Tile>
      )}
      {principles && principles.length > 0 && (
        <Tile title="Guiding principles" wide>
          <ol className={page.principles}>
            {principles.map((principle) => (
              <li key={principle}>{principle}</li>
            ))}
          </ol>
        </Tile>
      )}
      {styleReferences && styleReferences.length > 0 && (
        <Tile title="Style references">
          <ul className={page.references}>
            {styleReferences.map((reference) => (
              <li key={reference}>
                <a
                  href={
                    isSafeLink(reference)
                      ? reference
                      : `https://duckduckgo.com/?ia=images&iax=images&q=${encodeURIComponent(`${reference} interior`)}`
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {reference}
                </a>
              </li>
            ))}
          </ul>
        </Tile>
      )}
      {/* Kept for inspiration photos, once the Home can hold them. */}
      <div className={page.photos} aria-hidden />
    </div>
  );
}

function Tile({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={wide ? `${page.tile} ${page.wide}` : page.tile}>
      <h3 className={page.tileTitle}>{title}</h3>
      {children}
    </section>
  );
}

/** A Decision of the Basis as a chip: its state's mark, its title, kind, and why it is there. */
function BasisChip({ home, entry }: { home: string; entry: BasisEntry }) {
  return (
    <span className={`${page.chip} ${page[`state-${entry.state}`]}`}>
      <StateMark state={entry.state} className={page.chipMark} />
      <Link to={decisionPath(home, entry.slug)}>{entry.title}</Link>
      <span className={page.chipMeta}>
        <Parts>
          {KIND_LABEL[entry.kind]}
          {STATE_LABEL[entry.state]}
          {entry.fulfilledAt && "Fulfilled"}
          {entry.automatic && automaticBasisNote(entry.kind)}
        </Parts>
      </span>
    </span>
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

/**
 * "Supports · Note", then what it is: a Decision as a chip, a Note in the user's words as a
 * quote, a Session by its day; and its reason, in the user's words, quoted.
 */
function EvidenceLine({ home, entry }: { home: string; entry: EvidenceEntry }) {
  return (
    <>
      <span className={`${page.stance} ${page[entry.stance]}`}>
        {sentence(entry.stance)} · {EVIDENCE_KIND[entry.kind]}
      </span>{" "}
      {entry.kind === "decision" ? (
        <Link className={page.chip} to={decisionPath(home, entry.id)}>
          {entry.name}
        </Link>
      ) : entry.kind === "note" ? (
        <q className={page.quote}>{entry.name}</q>
      ) : (
        <span>{entry.name}</span>
      )}
      {entry.note && (
        <>
          {" "}
          <q className={page.quote}>{entry.note}</q>
        </>
      )}
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
    <p className={page.markLine}>
      {!flag.clearedAt && (
        <>
          <FlagDot />{" "}
        </>
      )}
      <FlagCause home={home} flag={flag} />, raised {formatDate(flag.raisedAt)}:{" "}
      {settled(flag.clearedAt, "cleared", flag)}
    </p>
  );
}

function ConflictState({ conflict }: { conflict: Conflict }) {
  return (
    <p className={page.markLine}>
      {conflict.description}, raised {formatDate(conflict.raisedAt)}:{" "}
      {settled(conflict.resolvedAt, "resolved", conflict)}
    </p>
  );
}
