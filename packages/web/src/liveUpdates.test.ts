import { expect, it } from "vitest";
import { queriesShowing } from "./liveUpdates";

const log = ["change-log", "flat"];
const shopping = ["shopping", "flat"];
const found = ["find-index", "flat"];

it.each([
  ["home", [["homes"], ["home", "flat"], shopping, log]],
  ["level", [["home", "flat"], ["room", "flat"], ["blueprints", "flat"], found, log]],
  ["room", [["home", "flat"], ["room", "flat"], shopping, found, log]],
  ["wall", [["room", "flat"], shopping, log]],
  ["window", [["room", "flat"], shopping, log]],
  ["door", [["room", "flat"], shopping, log]],
  ["surface", [["room", "flat"], shopping, log]],
  ["feature", [["room", "flat"], shopping, found, log]],
  ["item", [["items", "flat"], ["room", "flat"], ["home", "flat"], shopping, found, log]],
  ["constraint", [["constraints", "flat"], log]],
  ["note", [["notes", "flat"], log]],
  ["session", [["sessions", "flat"], log]],
  ["blueprint", [["home", "flat"], ["blueprints", "flat"], log]],
  ["decision", [["decisions", "flat"], ["room", "flat"], shopping, found, log]],
  ["flag", [["decisions", "flat"], ["room", "flat"], shopping, found, log]],
  ["conflict", [["decisions", "flat"], ["room", "flat"], shopping, found, log]],
])("a %s change refetches the queries showing it, and the change log", (kind, keys) => {
  expect(queriesShowing(kind, "flat")).toEqual(keys);
});

it("refetches everything for the Home on a record kind it does not know", () => {
  expect(queriesShowing("listing", "flat")).toHaveLength(12);
});
