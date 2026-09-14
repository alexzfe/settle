# Home Intake trigger prompts

**Status: DRAFT, for the user to revise.** Written in slice 1 from the draft trigger description in [skill-set.md](../skill-set.md#trigger-descriptions). Until the user has revised this set, only the two prompts marked *committed* are eval cases in `plugin/evals/`. Once it is revised, each prompt becomes a `home-intake-fires-<n>` or `home-intake-skips-<n>` case.

## Should fire

| # | Prompt | Why it should fire |
|---|---|---|
| 1 | add the spare bedroom to my home | Adds a Room. *Committed as `home-intake-fires-1`* |
| 2 | We've just moved into a new flat. Can you set it up? It's got a kitchen-diner, two bedrooms, a bathroom and a hallway. | Sets up a new Home by describing its Rooms |
| 3 | I forgot to add the downstairs loo. | Adds a missing Room, without the word "room" |
| 4 | We knocked the kitchen and dining room through, so it's one space now. Can you update that? | Corrects the Rooms after building work |
| 5 | the living room is 4.2 m, not 4 | Corrects a measurement. The spec's own example |
| 6 | Here's our floor plan as a PDF. Can you read the rooms off it? | Home Intake from a Blueprint |
| 7 | Let's go through my house room by room so you know what's where. | Asks for the interview itself |
| 8 | There's also a small balcony off the main bedroom. | A balcony is a Room too |
| 9 | I want to tell you about the furniture I already have: a grey three-seater sofa and an oak dining table, both in the lounge. | Records Items the user owns |
| 10 | What have you got recorded for the office so far? | Reads a Room back |

## Near misses (should not fire)

| # | Prompt | Which boundary it tests |
|---|---|---|
| 1 | I'm viewing a two-bedroom flat tomorrow. What should I check before making an offer? | Buying or evaluating property. *Committed as `home-intake-skips-1`* |
| 2 | What colour should I paint the hallway? It only gets north light. | Colors belong to Color |
| 3 | I need a new sofa for the living room. Something under 85 cm tall. | Shopping belongs to Purchase |
| 4 | I don't know what style I like. Can you help me work it out? | Design advice belongs to Design Direction |
| 5 | Make the bedroom feel calmer. | A Room Direction, not a fact about the Room |
| 6 | Build me a React component that draws a floor plan from a list of rooms. | Software, not the user's Home |
| 7 | Add a bedroom to the house in my Minecraft world. | A game, not a dwelling |
| 8 | Set up my home directory so my dotfiles are symlinked from ~/dotfiles. | "Home" in the computing sense |
| 9 | Add the bedroom lights to Home Assistant. | Smart-home configuration, not the Home record |
| 10 | Design a colour palette for my website's home page. | Web design, "home" as a page |

## Notes for the revision

- The should-fire set covers the description's three uses (set up the Home, add or fix a Room or a measurement, record owned furniture), plus a Blueprint and a read-back. Slice 1's Home Intake only records Rooms by name and Level. Prompts 5, 6 and 9 still belong in the set, because they test the trigger, not what the Skill can do yet.
- The near misses cover each "Not for" clause (design advice, colors, shopping, property) and four senses of "home" or "room" outside a dwelling.
