import { defineOperation } from "../registry.js";
import { type GetChangeLogResult, getChangeLogInput } from "./schemas.js";
import { requireHome } from "./scope.js";

const DEFAULT_LIMIT = 200;

export const getChangeLog = defineOperation({
  name: "get_change_log",
  description:
    "The Home's change log, newest first: when, from the web UI or which Session, which " +
    "record and field, the old and new values, and any reason given; `more` says whether older " +
    "changes were left out. Never given to the AI.",
  input: getChangeLogInput,
  readOnly: true,
  surface: "web",
  handler(context, input): GetChangeLogResult {
    const home = requireHome(context);
    const limit = input.limit ?? DEFAULT_LIMIT;
    // One more than asked, to know whether there are more.
    const changes = context.store.newestChanges(home.id, limit + 1);
    return {
      more: changes.length > limit,
      changes: changes.slice(0, limit).map((change) => ({
        at: change.at,
        origin: change.origin,
        recordKind: change.recordKind,
        record: change.recordSlug,
        ...(change.field === null ? {} : { field: change.field }),
        ...(change.old === undefined ? {} : { old: change.old }),
        ...(change.new === undefined ? {} : { new: change.new }),
        ...(change.reason === null ? {} : { reason: change.reason }),
      })),
    };
  },
});
