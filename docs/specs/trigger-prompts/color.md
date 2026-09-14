# Color trigger prompts

**Status: draft, written in slice 5 for the user to revise.** Only the two prompts marked *committed* are trigger cases in `plugin/evals/` so far; the rest become cases once the user approves them, as the Design Direction set did. A prompt that changes here changes its case.

## The trigger description

As in the Skill's frontmatter, unchanged from the draft in [skill-set.md](../skill-set.md#trigger-descriptions):

> Interviews the user to choose their home's palette of named colors, then the colors of each room's walls, ceiling, floor and woodwork, based on the home's direction and each room's daylight. Use for paint, wall colors, and which colors work together in the home ("what color for the hallway?", "is this grey too cold for a north room?"). Not for the color of a product being bought (purchase); not for UI, CSS, brand or chart colors.

## Should fire

| # | Prompt | Why it should fire |
|---|---|---|
| 1 | We need a colour palette for the whole house before we start painting. Can you help us choose one? | Settles the Palette, the Skill's key use. *Committed as `color-fires-1`* |
| 2 | What colour should we paint the hallway? | A Room color. The description's own example |
| 3 | Is this grey too cold for our north-facing bedroom? It's Farrow & Ball Purbeck Stone. | A paint judged against a Room's daylight. The description's other example |
| 4 | Which colours would go with our oak floors and the terracotta tiles in the kitchen? | Which colors work together in the Home, from what stays |
| 5 | Should the living room ceiling be the same colour as the walls, or just white? | A ceiling Surface |
| 6 | We'd love a dark green feature wall behind the bed. Would that work? | One Wall's color, and possibly a Palette change |
| 7 | Gloss or satin for the skirting boards and door frames? | A woodwork finish |
| 8 | The kitchen only gets morning sun. What wall colours would suit it? | Daylight-led wall colors, without the word "paint" |
| 9 | Our palette feels too beige now. Can we add an accent colour? | Changing a Locked Palette |
| 10 | We painted the living room walls at the weekend, in the colour we picked. | Fulfilling a Room color |

## Near misses (should not fire)

| # | Prompt | Which boundary it tests |
|---|---|---|
| 1 | I need a colour palette for my website's CSS: a warm primary, a neutral background, and an accent for buttons. | CSS colors, in the Skill's own vocabulary. *Committed as `color-skips-1`* |
| 2 | What goes with navy? I've just bought a navy suit for a wedding. | "What goes with navy?", about clothes |
| 3 | Pick a brand colour for my interior design studio's logo and business cards. | Brand colors, about interiors |
| 4 | Which colours should the bars in this chart be, so colour-blind readers can tell them apart? | Chart colors |
| 5 | Which colour should the new sofa be, the rust velvet or the oatmeal linen? | The color of a product being bought belongs to Purchase |
| 6 | I need a rug for the living room. Which colours would work with our palette? | Purchase applies the Palette to a product; Color only extends it |
| 7 | Change my terminal's colour scheme to something easier on the eyes. | UI colors |
| 8 | The kitchen walls are cream at the moment, in eggshell. Can you note that down? | Recording a Surface as it is now belongs to Home Intake |
| 9 | Should the house feel warm or cool overall? We can't decide. | Color temperature belongs to the Design Direction |
| 10 | I don't know what style I like. Can you help me work it out? | The overall style belongs to Design Direction |
| 11 | I'm viewing a flat tomorrow with bright yellow walls. Should that put me off making an offer? | Buying or evaluating property |
| 12 | Colour-grade my holiday photos so they look warmer. | Photo editing, not the Home |

## Notes for the revision

- The should-fire set covers the Palette (1, 4, 9), Room colors on each kind of Surface (2, 3, 5 to 8), and Fulfilment (10). Prompt 10 is the least likely to fire: the description never mentions recording finished painting, where Purchase's says "I bought the chair". If it misses, either add "or record that a room has been painted" to the description, or accept that the user names the Skill for it.
- Prompts 4 and 6 mention no Palette, so they also test that a single Room's question reaches Color rather than Design Direction. Prompt 9 fires only if the Home has a Palette; as a trigger case it still tests that the request reaches the Skill.
- Near misses 1 to 4 and 7 cover each "not for" clause (CSS, brand, chart, UI), with "what goes with navy?" given a context so it is clearly about clothes: bare, in a Home Folder, it may well be about the Home, and then firing is right. Near misses 5 and 6 test the Purchase boundary, and 6 is the closest: the answer applies the Palette but doesn't change it. Until Purchase exists (slice 6) the Agent has no other Skill to hand them to, so they may fire anyway in the first run; that is worth seeing.
- Near misses 8 to 10 test the neighbouring PoC Skills: a Surface recorded as it is now belongs to Home Intake, and temperature and style to Design Direction. Near miss 9 is the closest of these, since "warm or cool" reads as a color question.
- Design Direction's near miss 5 ("What colour should I paint the hallway? It only gets north light.") is close to should-fire 2 here. Now that Color exists, the first full trigger run shows whether that prompt reaches Color instead of firing Design Direction.
