// The text the AI reads. Rules from docs/specs/home-model.md#context-tiers: leave out empty
// fields, and name records by their readable slugs, never database ids.

export interface NamedRecord {
  name: string;
  slug: string;
}

export interface OverviewView {
  home: { name: string; city: string; country: string; latitude: number };
  levels: { name: string; storey: number }[];
  /** `level` is the Level's name. */
  rooms: (NamedRecord & { level: string })[];
}

/** The parts of the opening, each delivered once per Session. Slice 4 adds the Decisions block. */
export type OpeningBlock = "overview";

/** The opening's blocks in `blocks`, in their fixed order; empty when there are none. */
export function renderOpening(view: OverviewView, blocks: readonly OpeningBlock[]): string {
  return blocks.includes("overview") ? renderHomeOverview(view) : "";
}

/** The Home's name and its Home Overview: its facts, its Levels, and one line per Room. */
export function renderHomeOverview({ home, levels, rooms }: OverviewView): string {
  const lines = [
    `Home: ${home.name}`,
    `Location: ${home.city}, ${home.country} (latitude ${formatLatitude(home.latitude)})`,
  ];
  if (levels.length > 0) {
    lines.push(
      `Levels: ${levels.map((level) => `${level.name} (storey ${level.storey})`).join(", ")}`,
    );
  }
  lines.push("");
  if (rooms.length === 0) {
    lines.push("Rooms: none recorded yet");
  } else {
    lines.push("Rooms:");
    for (const room of rooms) lines.push(`- ${named(room)}: ${room.level}`);
  }
  return lines.join("\n");
}

export interface RoomSheetView {
  room: NamedRecord;
  level: { name: string; storey: number };
}

/** Everything recorded about one Room. */
export function renderRoomSheet({ room, level }: RoomSheetView): string {
  return [`Room: ${named(room)}`, `Level: ${level.name} (storey ${level.storey})`].join("\n");
}

/** One change a write made, as its receipt reports it. Levels are named by their names. */
export type ReceiptLine =
  | { change: "room_created"; room: NamedRecord; level: string }
  | { change: "room_moved"; room: NamedRecord; from: string; to: string }
  | { change: "room_unchanged"; room: NamedRecord; level: string };

/** A write's receipt: one line per change, never the record it wrote. */
export function renderReceipt(lines: readonly ReceiptLine[]): string {
  return lines.map(receiptLine).join("\n");
}

function receiptLine(line: ReceiptLine): string {
  switch (line.change) {
    case "room_created":
      return `${named(line.room)}: created on ${line.level}`;
    case "room_moved":
      return `${named(line.room)}: moved from ${line.from} to ${line.to}`;
    case "room_unchanged":
      return `${named(line.room)}: already recorded on ${line.level}, nothing changed`;
  }
}

function named(record: NamedRecord): string {
  return `${record.name} (${record.slug})`;
}

function formatLatitude(latitude: number): string {
  return `${Math.abs(latitude).toFixed(1)}° ${latitude < 0 ? "S" : "N"}`;
}
