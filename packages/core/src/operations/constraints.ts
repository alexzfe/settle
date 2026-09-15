import { CoreError } from "../errors.js";
import { defineOperation } from "../registry.js";
import { named } from "../render.js";
import { uniqueSlug } from "../slug.js";
import { active, list } from "./lookup.js";
import { toConstraint } from "./model.js";
import {
  type ListConstraintsResult,
  listConstraintsInput,
  type ReceiptResult,
  setConstraintsInput,
} from "./schemas.js";
import { requireHome, requireSession } from "./scope.js";
import { sameName, Writer } from "./writer.js";

export const setConstraints = defineOperation({
  name: "set_constraints",
  description:
    "Adds or removes a batch of Constraints and returns a receipt with one line per change. A " +
    "Constraint is a fact about the user's situation that every Skill must obey as strictly as " +
    'a Locked Decision, though it is not a design choice: "Rented: no painting or drilling", ' +
    '"Two cats", "Grandmother\'s dresser stays". Add or remove one only once the user has ' +
    "agreed: read the exact wording back first, and pass `reason` quoting their permission; " +
    "a removal without one is refused. A softer fact that should not bind every " +
    "Decision is a Note (save_note). Removing a Constraint Archives it: it leaves the Home " +
    "Overview but is kept. The Home Overview lists the Constraints in force with their slugs. " +
    "Needs the open Session's id as `session`.",
  input: setConstraintsInput,
  readOnly: false,
  surface: "agent",
  handler(context, input): ReceiptResult {
    if (!input.add?.length && !input.remove?.length) {
      throw new CoreError("validation", "Give Constraints to `add`, slugs to `remove`, or both.");
    }
    const { store } = context;
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    const reason = input.reason?.trim() || undefined;
    if (input.remove?.length && !reason) {
      throw new CoreError(
        "reason_required",
        "Removing a Constraint from a Session needs a reason: why, in a sentence, quoting the " +
          'user\'s words when they gave permission (The user: "yes, we own it now"). Call again ' +
          "with `reason`.",
      );
    }
    const receipt = context.write(session.slug, (log) => {
      const writer = new Writer(context, home, log, undefined);
      const constraints = store.list("constraints", home.id);
      for (const text of input.add ?? []) {
        const same = constraints.find((each) => active(each) && sameName(each.text, text));
        if (same) {
          writer.line(
            named({ name: same.text, slug: same.slug }),
            "already recorded, nothing changed",
          );
          continue;
        }
        const slug = uniqueSlug(text, "constraint", (taken) =>
          store.slugTaken("constraints", taken, home.id),
        );
        // Logged by hand, so the change carries the user's permission as its reason.
        const created = store.insert("constraints", {
          homeId: home.id,
          slug,
          text,
          archivedAt: null,
          archivedReason: null,
        });
        writer.logged({
          recordKind: "constraint",
          record: created,
          new: { text },
          ...(reason ? { reason } : {}),
        });
        constraints.push(created);
        writer.line(named({ name: text, slug }), "added");
      }
      for (const slug of input.remove ?? []) {
        const constraint = constraints.find((each) => each.slug === slug);
        if (!constraint) {
          const current = constraints
            .filter(active)
            .map((each) => ({ name: each.text, slug: each.slug }));
          throw new CoreError(
            "not_found",
            `This Home has no Constraint "${slug}". ` +
              (current.length > 0 ? `Its Constraints are ${list(current)}.` : "It has none."),
          );
        }
        const done = writer.archive(
          "constraints",
          "constraint",
          constraint,
          true,
          context.now(),
          reason,
        );
        writer.line(
          named({ name: constraint.text, slug }),
          done ? "removed (Archived)" : "already removed, nothing changed",
        );
      }
      return writer.receipt();
    });
    return { receipt };
  },
  text: ({ receipt }) => receipt,
});

export const listConstraints = defineOperation({
  name: "list_constraints",
  description: "The Home's Constraints in force, in the order added; Archived ones on request.",
  input: listConstraintsInput,
  readOnly: true,
  surface: "web",
  handler(context, input): ListConstraintsResult {
    const home = requireHome(context);
    return {
      constraints: context.store
        .list("constraints", home.id)
        .filter((each) => input.archived === true || active(each))
        .map(toConstraint),
    };
  },
});
