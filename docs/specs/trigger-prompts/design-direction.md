# Design Direction trigger prompts

**Status: DRAFT, for the user to revise.** Written in slice 4 from the draft trigger description in [skill-set.md](../skill-set.md#trigger-descriptions). Until the user has revised this set, only the two prompts marked *committed* are eval cases in `plugin/evals/`. Once it is revised, each prompt becomes a `design-direction-fires-<n>` or `design-direction-skips-<n>` case.

## The trigger description

As in the Skill's frontmatter, from the spec's draft:

> Interviews the user to settle their home's overall style: mood, warmth, key materials, style references, guiding principles. Also settles each room's direction and what an undecided room is for. Use when the user wants to work out their style or how a room should feel or be used ("I don't know what style I like", "make the bedroom calmer", "office or guest room?"). Not for specific colors (color) or things to buy (purchase); not for app, web or brand design.

## Should fire

| # | Prompt | Why it should fire |
|---|---|---|
| 1 | I don't know what style I like. Can you help me work it out? | Settles the Design Direction. The description's own example. *Committed as `design-direction-fires-1`* |
| 2 | Make the bedroom feel calmer. | A Room Direction |
| 3 | Should the spare room be an office or a guest room? | The use of an undecided Room |
| 4 | Here are some pictures I've saved from Pinterest. What do they say about my taste? | Inspiration images become style references |
| 5 | We want the whole flat to feel warm and cosy but not cluttered. Where do we start? | Mood and principles, without the word "style" |
| 6 | Is Japandi right for us, or is it just a trend? | A style reference, weighed |
| 7 | The kids' room should feel playful, but I don't want it to clash with the rest of the house. | A Room Direction that must refine the Design Direction |
| 8 | Everything I buy looks nice on its own, but nothing goes together. Help me pick a direction. | The problem a Design Direction solves |
| 9 | Which materials should run through the house: oak, linen, brass? | Key materials |
| 10 | Let's rethink the direction we settled on. It feels too cold now. | Reopening a Locked Design Direction |

## Near misses (should not fire)

| # | Prompt | Which boundary it tests |
|---|---|---|
| 1 | I need a style direction for my bakery's new website: the mood, the fonts, and a look that feels warm and rustic. | Web and brand design, in the Skill's own vocabulary. *Committed as `design-direction-skips-1`* |
| 2 | What colour should I paint the hallway? It only gets north light. | Specific colors belong to Color |
| 3 | Which sofa should I buy, the grey velvet one or the oatmeal linen one? | Things to buy belong to Purchase |
| 4 | Add the spare bedroom to my home. | Recording a Room belongs to Home Intake |
| 5 | The living room is 4.2 m, not 4. | Correcting a measurement belongs to Home Intake |
| 6 | Make my VS Code theme warmer and lower contrast. | Software styling |
| 7 | Write the brand guidelines for my interior design studio: tone of voice, logo use, and imagery. | Brand design, about interiors |
| 8 | I'm viewing a period flat tomorrow. Would its style suit us, and should we make an offer? | Buying or evaluating property |
| 9 | Describe the interior of the starship bridge in my novel: moody, cool light, brushed steel. | Fiction, not the user's Home |
| 10 | What mood does Hopper's *Nighthawks* convey? | Art criticism, not a Home |

## Notes for the revision

- The should-fire set covers the description's three uses (the Home's style, a Room's feel, an undecided Room's use), plus inspiration images, one style reference, key materials, and a Reopen. Prompt 10 fires only if the Home has a Locked Direction; as a trigger case it still tests that the request reaches the Skill.
- The near misses cover each "Not for" clause (colors, things to buy, app, web and brand design), Home Intake's two nearest uses, property, and two senses of "mood" and "style" outside a Home.
- Near miss 2 may fire the Skill until a Color Skill exists, since no other Skill can take it. That is worth seeing in the first run, not a reason to drop it.
