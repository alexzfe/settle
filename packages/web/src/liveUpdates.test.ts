import { expect, it } from "vitest";
import { queriesShowing } from "./liveUpdates";

const log = ["change-log", "flat"];

it.each([
  ["home", [["homes"], ["home", "flat"], log]],
  ["level", [["home", "flat"], ["room", "flat"], ["blueprints", "flat"], log]],
  ["room", [["home", "flat"], ["room", "flat"], log]],
  ["wall", [["room", "flat"], log]],
  ["window", [["room", "flat"], log]],
  ["door", [["room", "flat"], log]],
  ["surface", [["room", "flat"], log]],
  ["feature", [["room", "flat"], log]],
  ["item", [["items", "flat"], ["room", "flat"], ["home", "flat"], log]],
  ["constraint", [["constraints", "flat"], log]],
  ["note", [["notes", "flat"], log]],
  ["session", [["sessions", "flat"], log]],
  ["blueprint", [["home", "flat"], ["blueprints", "flat"], log]],
  ["decision", [["decisions", "flat"], ["room", "flat"], log]],
  ["flag", [["decisions", "flat"], ["room", "flat"], log]],
  ["conflict", [["decisions", "flat"], ["room", "flat"], log]],
])("a %s change refetches the queries showing it, and the change log", (kind, keys) => {
  expect(queriesShowing(kind, "flat")).toEqual(keys);
});

it("refetches everything for the Home on a record kind it does not know", () => {
  expect(queriesShowing("listing", "flat")).toHaveLength(10);
});
