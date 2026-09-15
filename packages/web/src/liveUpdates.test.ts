import { expect, it } from "vitest";
import { queriesShowing } from "./liveUpdates";

const log = ["change-log", "flat"];
const shopping = ["shopping", "flat"];

it.each([
  ["home", [["homes"], ["home", "flat"], shopping, log]],
  ["level", [["home", "flat"], ["room", "flat"], ["blueprints", "flat"], log]],
  ["room", [["home", "flat"], ["room", "flat"], shopping, log]],
  ["wall", [["room", "flat"], shopping, log]],
  ["window", [["room", "flat"], shopping, log]],
  ["door", [["room", "flat"], shopping, log]],
  ["surface", [["room", "flat"], shopping, log]],
  ["feature", [["room", "flat"], shopping, log]],
  ["item", [["items", "flat"], ["room", "flat"], ["home", "flat"], shopping, log]],
  ["constraint", [["constraints", "flat"], log]],
  ["note", [["notes", "flat"], log]],
  ["session", [["sessions", "flat"], log]],
  ["blueprint", [["home", "flat"], ["blueprints", "flat"], log]],
  ["decision", [["decisions", "flat"], ["room", "flat"], shopping, log]],
  ["flag", [["decisions", "flat"], ["room", "flat"], shopping, log]],
  ["conflict", [["decisions", "flat"], ["room", "flat"], shopping, log]],
])("a %s change refetches the queries showing it, and the change log", (kind, keys) => {
  expect(queriesShowing(kind, "flat")).toEqual(keys);
});

it("refetches everything for the Home on a record kind it does not know", () => {
  expect(queriesShowing("listing", "flat")).toHaveLength(11);
});
