import { defineOperation } from "../registry.js";
import { type GetChangeLogResult, getChangeLogInput } from "./schemas.js";
import { requireHome } from "./scope.js";

const DEFAULT_LIMIT = 200;

export const getChangeLog = defineOperation({
  name: "get_change_log",
  description:
    "The Home's change log, newest first: when, from the web UI or which Session, which " +
    "record and field, the old and new values, and any reason given. Never given to the AI.",
  input: getChangeLogInput,
  readOnly: true,
  surface: "web",
  handler(context, input): GetChangeLogResult {
    const home = requireHome(context);
    const changes = context.store
      .changes(home.id)
      .reverse()
      .slice(0, input.limit ?? DEFAULT_LIMIT);
    return {
      changes: changes.map((change) => ({
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
