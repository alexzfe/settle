// The pencil's form: every field the web may edit on an Item, empty ones included (that is how the
// user adds more), sent to edit_item as only what changed. Name, category, quantity, Room, Wall,
// archiving and replacing are Session work, so they are not here.

import type { Color, Condition } from "@settle/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import styles from "./App.module.css";
import { call, type EditItemInput, type Item } from "./api";
import { cmFromMm, mmFromCm, sentence } from "./format";
import form from "./ItemPage.module.css";
import { isPartialDate, warrantyUntil } from "./itemDates";
import { queriesShowing } from "./liveUpdates";
import { Card } from "./ui/Card";

type Fields = EditItemInput["fields"];

const TEXT_FIELDS = [
  ["brand", "Brand"],
  ["model", "Model"],
  ["positionNote", "Position note"],
  ["link", "Product link"],
  ["boughtOn", "Bought on"],
  ["boughtFrom", "Bought from"],
  ["pricePaid", "Price paid"],
  ["warrantyUntil", "Warranty until"],
  ["serialNumber", "Serial number"],
  ["manualLink", "Manual or support link"],
] as const;

type TextField = (typeof TEXT_FIELDS)[number][0];

const LINKS = new Set<TextField>(["link", "manualLink"]);

const HINT: Partial<Record<TextField, string>> = {
  boughtOn: "A year, a month, or a day: 2024, 2024-03, 2024-03-14.",
  warrantyUntil: 'A date like bought on, or a length from bought on: "2 years", "18 months".',
  pricePaid: 'As you would say it: "S/ 1,299", "about 400 soles".',
};

const SIZE_FIELDS = [
  ["width", "Width"],
  ["depth", "Depth"],
  ["height", "Height"],
] as const;

type SizeField = (typeof SIZE_FIELDS)[number][0];

/** How the pencil records a size: the user's tape (the default), or a guess. */
type SizeProvenance = "measured" | "estimated";

interface SizeDraft {
  cm: string;
  provenance: SizeProvenance;
}

const CONDITIONS: Condition[] = ["good", "worn", "damaged"];

/** The form's contents: what the user sees in each box. */
export interface ItemDraft {
  text: Record<TextField, string>;
  sizes: Record<SizeField, SizeDraft>;
  condition: Condition | "";
  colors: string[];
  materials: string[];
}

/** The switch a size starts on: Estimated for an Estimated value, else Measured. */
function startingProvenance(value: Item[SizeField]): SizeProvenance {
  return value?.provenance === "estimated" ? "estimated" : "measured";
}

/** The form filled from the Item as it is recorded. */
export function draftOf(item: Item): ItemDraft {
  const text = Object.fromEntries(
    TEXT_FIELDS.map(([field]) => [field, item[field] ?? ""]),
  ) as Record<TextField, string>;
  const sizes = Object.fromEntries(
    SIZE_FIELDS.map(([field]) => {
      const value = item[field];
      return [
        field,
        { cm: value ? cmFromMm(value.mm) : "", provenance: startingProvenance(value) },
      ];
    }),
  ) as Record<SizeField, SizeDraft>;
  return {
    text,
    sizes,
    condition: item.condition ?? "",
    colors: item.colors?.map((color) => color.name) ?? [],
    materials: item.materials ?? [],
  };
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((each, index) => each === b[index]);

const filled = (list: readonly string[]) => list.map((each) => each.trim()).filter(Boolean);

/**
 * What edit_item is sent: only the fields that differ from the Item, a cleared one as null. Sizes
 * go from centimetres to millimetres, and a warranty given as a length becomes a date. Errors say
 * which boxes cannot be read; nothing is sent while there are any.
 */
export function changedFields(item: Item, draft: ItemDraft): { fields: Fields; errors: string[] } {
  const fields: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [field, label] of TEXT_FIELDS) {
    let typed: string = draft.text[field].trim();
    if (typed && field === "boughtOn" && !isPartialDate(typed)) {
      errors.push(`${label}: give a year, a month, or a day, like 2024, 2024-03, or 2024-03-14.`);
      continue;
    }
    if (typed && field === "warrantyUntil") {
      const read = warrantyUntil(typed, draft.text.boughtOn.trim());
      if ("error" in read) {
        errors.push(`${label}: ${read.error}`);
        continue;
      }
      typed = read.value;
    }
    if (typed === (item[field] ?? "")) continue;
    fields[field] = typed === "" ? null : typed;
  }
  for (const [field, label] of SIZE_FIELDS) {
    const { cm, provenance } = draft.sizes[field];
    const recorded = item[field];
    if (cm.trim() === "") {
      if (recorded) fields[field] = null;
      continue;
    }
    const mm = mmFromCm(cm);
    if (mm === undefined) {
      errors.push(`${label}: give it in centimetres, like 153 or 153.5.`);
      continue;
    }
    if (recorded && recorded.mm === mm && provenance === startingProvenance(recorded)) continue;
    fields[field] = { mm, provenance };
  }
  if (draft.condition !== (item.condition ?? "")) {
    fields.condition = draft.condition === "" ? null : draft.condition;
  }
  const colors = filled(draft.colors);
  const recordedColors = item.colors ?? [];
  if (
    !same(
      colors,
      recordedColors.map((color) => color.name),
    )
  ) {
    // A color kept by name keeps what else is recorded about it; a new name is judged by eye.
    fields.colors =
      colors.length === 0
        ? null
        : colors.map(
            (name): Color =>
              recordedColors.find((color) => color.name === name) ?? {
                name,
                provenance: "estimated",
              },
          );
  }
  const materials = filled(draft.materials);
  if (!same(materials, item.materials ?? [])) {
    fields.materials = materials.length === 0 ? null : materials;
  }
  return { fields: fields as Fields, errors };
}

/** The pencil's form over the fact card, with Save and Cancel. */
export function ItemEdit({ home, item, onDone }: { home: string; item: Item; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => draftOf(item));
  const [errors, setErrors] = useState<string[]>([]);
  const id = useId();
  const save = useMutation({
    mutationFn: (fields: Fields) => call("edit_item", { home, item: item.slug, fields }),
    onSuccess: () => {
      // A changed value may flag the Decisions citing it, so theirs refetch too. Each query is
      // invalidated once: a second invalidation would cancel the first refetch and fetch again.
      const keys = [...queriesShowing("item", home), ...queriesShowing("decision", home)];
      const once = new Map(keys.map((queryKey) => [JSON.stringify(queryKey), queryKey]));
      for (const queryKey of once.values()) void queryClient.invalidateQueries({ queryKey });
      onDone();
    },
  });
  const setText = (field: TextField, value: string) =>
    setDraft({ ...draft, text: { ...draft.text, [field]: value } });
  const setSize = (field: SizeField, value: Partial<SizeDraft>) =>
    setDraft({ ...draft, sizes: { ...draft.sizes, [field]: { ...draft.sizes[field], ...value } } });
  return (
    <Card className={form.card}>
      <form
        className={form.form}
        aria-label="Edit its facts"
        onSubmit={(event) => {
          event.preventDefault();
          const { fields, errors } = changedFields(item, draft);
          setErrors(errors);
          if (errors.length > 0) return;
          if (Object.keys(fields).length === 0) {
            onDone();
            return;
          }
          save.mutate(fields);
        }}
      >
        <fieldset className={form.group}>
          <legend>Size, in centimetres</legend>
          {SIZE_FIELDS.map(([field, label]) => (
            <div key={field} className={form.size}>
              <div className={form.field}>
                <label htmlFor={`${id}-${field}`}>{label}</label>
                <span className={form.withUnit}>
                  <input
                    id={`${id}-${field}`}
                    inputMode="decimal"
                    value={draft.sizes[field].cm}
                    onChange={(event) => setSize(field, { cm: event.target.value })}
                  />
                  <span aria-hidden>cm</span>
                </span>
              </div>
              <div
                className={form.switch}
                role="radiogroup"
                aria-label={`${label}: how it is known`}
              >
                {(["measured", "estimated"] as const).map((provenance) => (
                  <label key={provenance}>
                    <input
                      type="radio"
                      name={`${id}-${field}`}
                      checked={draft.sizes[field].provenance === provenance}
                      onChange={() => setSize(field, { provenance })}
                    />
                    <span>{sentence(provenance)}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>

        <div className={form.field}>
          <label htmlFor={`${id}-condition`}>Condition</label>
          <select
            id={`${id}-condition`}
            value={draft.condition}
            onChange={(event) =>
              setDraft({ ...draft, condition: event.target.value as ItemDraft["condition"] })
            }
          >
            <option value="">Not set</option>
            {CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {sentence(condition)}
              </option>
            ))}
          </select>
        </div>

        <ListField
          label="Colors"
          noun="color"
          values={draft.colors}
          onChange={(colors) => setDraft({ ...draft, colors })}
        />
        <ListField
          label="Materials"
          noun="material"
          values={draft.materials}
          onChange={(materials) => setDraft({ ...draft, materials })}
        />

        {TEXT_FIELDS.map(([field, label]) => (
          <div key={field} className={form.field}>
            <label htmlFor={`${id}-${field}`}>{label}</label>
            <input
              id={`${id}-${field}`}
              value={draft.text[field]}
              inputMode={LINKS.has(field) ? "url" : undefined}
              aria-describedby={HINT[field] ? `${id}-${field}-hint` : undefined}
              onChange={(event) => setText(field, event.target.value)}
            />
            {HINT[field] && (
              <span id={`${id}-${field}-hint`} className={form.hint}>
                {HINT[field]}
              </span>
            )}
          </div>
        ))}

        {errors.length > 0 && (
          <ul role="alert" className={`${styles.error} ${form.errors}`}>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        {save.isError && (
          <p role="alert" className={styles.error}>
            {save.error.message}
          </p>
        )}
        <div className={form.buttons}>
          <button type="submit" disabled={save.isPending}>
            Save
          </button>
          <button type="button" className="secondary" onClick={onDone}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

/** A short list edited in place: one box per entry, a Remove beside each, and an Add below. */
function ListField({
  label,
  noun,
  values,
  onChange,
}: {
  label: string;
  noun: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset className={form.group}>
      <legend>{label}</legend>
      {values.map((value, index) => (
        // The boxes hold no state of their own, so their position is key enough.
        <div key={index} className={form.listRow}>
          <input
            aria-label={`${sentence(noun)} ${index + 1}`}
            value={value}
            onChange={(event) =>
              onChange(values.map((each, at) => (at === index ? event.target.value : each)))
            }
          />
          <button
            type="button"
            className="secondary"
            aria-label={`Remove ${noun} ${index + 1}`}
            onClick={() => onChange(values.filter((_, at) => at !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...values, ""])}>
        Add a {noun}
      </button>
    </fieldset>
  );
}
