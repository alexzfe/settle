// Snapshots of the text the AI reads, rendered from the fixture Home. A new line in a snapshot
// must be justified against the Context tiers (docs/specs/home-model.md#context-tiers).
import { afterAll, beforeAll, expect, it } from "vitest";
import type { CallContext } from "./core.js";
import { createFixtureHome, type FixtureHome } from "./fixture/fixture-home.js";

let fixture: FixtureHome;
beforeAll(async () => {
  // Session ids come from this sequence, so the tool result's id is stable.
  let next = 0;
  fixture = await createFixtureHome({ random: (max) => next++ % max });
});
afterAll(() => fixture.core.close());

const agent = (session?: string): CallContext => ({
  caller: { kind: "session", session },
  home: fixture.home,
});
const snapshot = (name: string) => `./__snapshots__/${name}.txt`;

function toolText(name: string, output: unknown): string {
  const operation = fixture.core.operations.find((each) => each.name === name);
  if (!operation?.text) throw new Error(`${name} renders no text`);
  return operation.text(output);
}

it("renders the opening: the Home's name and its Home Overview", async () => {
  const result = await fixture.core.run("open_session", agent(), { skill: "home-intake" });
  await expect(result.opening).toMatchFileSnapshot(snapshot("opening"));
  await expect(toolText("open_session", result)).toMatchFileSnapshot(
    snapshot("open_session-result"),
  );
});

it("renders a Room Sheet", async () => {
  const { session } = await fixture.core.run("open_session", agent(), { skill: "home-intake" });
  const { sheet } = await fixture.core.run("get_room_sheet", agent(session), {
    session,
    room: "main-bedroom",
  });
  await expect(sheet).toMatchFileSnapshot(snapshot("room-sheet"));
});

it("renders write receipts", async () => {
  const { session } = await fixture.core.run("open_session", agent(), { skill: "home-intake" });
  const save = async (name: string, level?: string) =>
    (await fixture.core.run("save_room", agent(session), { session, name, level })).receipt;
  const receipts = [
    await save("Study", "First"),
    await save("Study", "ground"),
    await save("Study"),
  ];
  await expect(receipts.join("\n\n")).toMatchFileSnapshot(snapshot("receipts"));
});
