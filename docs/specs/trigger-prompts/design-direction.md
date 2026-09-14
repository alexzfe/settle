# Design Direction trigger prompts

**Status: DRAFT, for the user to revise.** Written in slice 4 from the draft trigger description in [skill-set.md](../skill-set.md#trigger-descriptions), and narrowed on 2026-09-14 when the user decided the Skill should fire rarely: on its own only for the first Design Direction or an outright request to rethink the overall style, and otherwise by name or by hand-off from another Skill. Until the user has revised this set, only the two prompts marked *committed* are eval cases in `plugin/evals/`. Once it is revised, each prompt becomes a `design-direction-fires-<n>` or `design-direction-skips-<n>` case.

## The trigger description

As in the Skill's frontmatter:

> Interviews the user to settle their home's overall style, normally once: mood, warmth, key materials, style references, guiding principles. Use only when the home has no design direction yet, or when the user says outright that they want to work out or rethink their overall style ("I don't know what style I like", "let's rethink the direction, it feels too cold"). It also settles a room's direction and what an undecided room is for, but only when invoked by name or when another skill hands it the question; a request about one room on its own is not a reason to use it. Not for specific colors (color) or things to buy (purchase); not for app, web or brand design.

## Should fire

| # | Prompt | Why it should fire |
|---|---|---|
| 1 | I don't know what style I like. Can you help me work it out? | Settles the Design Direction. The description's own example. *Committed as `design-direction-fires-1`* |
| 2 | Here are some pictures I've saved from Pinterest. What do they say about my taste for the house? | Working out the overall style from inspiration images |
| 3 | We want the whole flat to feel warm and cosy but not cluttered. Where do we start? | Mood and principles for the whole Home, without the word "style" |
| 4 | Is Japandi right for us as a direction for the house, or is it just a trend? | A style reference for the whole Home, weighed |
| 5 | Everything I buy looks nice on its own, but nothing goes together. Help me pick a direction. | The problem a Design Direction solves |
| 6 | Which materials should run through the whole house: oak, linen, brass? | Key materials, Home-wide |
| 7 | Let's rethink the direction we settled on. It feels too cold now. | Reopening a Locked Design Direction, asked outright |
| 8 | We've just moved in and recorded the rooms. What's the next step before we choose colours or buy anything? | The Home has no Direction yet, and the user asks what comes first |

## Near misses (should not fire)

| # | Prompt | Which boundary it tests |
|---|---|---|
| 1 | I need a style direction for my bakery's new website: the mood, the fonts, and a look that feels warm and rustic. | Web and brand design, in the Skill's own vocabulary. *Committed as `design-direction-skips-1`* |
| 2 | Make the bedroom feel calmer. | One Room's feel on its own: reached by name, or by hand-off from Color or Purchase |
| 3 | Should the spare room be an office or a guest room? | One Room's use on its own: reached by name |
| 4 | The kids' room should feel playful, but I don't want it to clash with the rest of the house. | A Room Direction on its own: reached by name or by hand-off |
| 5 | What colour should I paint the hallway? It only gets north light. | Specific colors belong to Color |
| 6 | Which sofa should I buy, the grey velvet one or the oatmeal linen one? | Things to buy belong to Purchase |
| 7 | Add the spare bedroom to my home. | Recording a Room belongs to Home Intake |
| 8 | The living room is 4.2 m, not 4. | Correcting a measurement belongs to Home Intake |
| 9 | Make my VS Code theme warmer and lower contrast. | Software styling |
| 10 | Write the brand guidelines for my interior design studio: tone of voice, logo use, and imagery. | Brand design, about interiors |
| 11 | I'm viewing a period flat tomorrow. Would its style suit us, and should we make an offer? | Buying or evaluating property |
| 12 | Describe the interior of the starship bridge in my novel: moody, cool light, brushed steel. | Fiction, not the user's Home |

## Notes for the revision

- The should-fire set covers the two firing cases only: no Design Direction yet (prompts 1 to 6 and 8) and an outright request to rethink the overall style (prompt 7). Prompt 7 fires only if the Home has a Locked Direction; as a trigger case it still tests that the request reaches the Skill. Prompt 8 depends on the opening telling the Agent there is no Direction, which a trigger eval cannot see; it may be better tested as a behaviour case.
- Near misses 2 to 4 were should-fire prompts before the narrowing. They now test that a single Room's feel or use does not fire the Skill on its own. Until Color and Purchase exist, the Agent has no other Skill to hand them to, so they may fire anyway in the first run; that is worth seeing, not a reason to drop them. When the user asks the same thing by name ("use design direction for the spare room"), the Skill handles it.
- The other near misses cover each "Not for" clause (colors, things to buy, app, web and brand design), Home Intake's two nearest uses, property, and "mood" and "style" outside a Home.
- Home Intake's closing suggestion and the Color and Purchase Skills point at Design Direction by name, so a user who never types its name still reaches it after recording the Home.
