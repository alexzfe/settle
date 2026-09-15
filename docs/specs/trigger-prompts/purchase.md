# Purchase trigger prompts

**Status: draft, written in slice 6 for the user to revise.** Only the two prompts marked *committed* are trigger cases in `plugin/evals/` so far; the rest become cases once the user approves them, as the Home Intake and Design Direction sets did. A prompt that changes here changes its case.

## The trigger description

As in the Skill's frontmatter, unchanged from the draft in [skill-set.md](../skill-set.md#trigger-descriptions):

> Interviews the user about something to buy for their home, turns the answers into must and prefer requirements traced to the rooms and earlier decisions, and writes a quick guide for the shop and a full guide to read ahead. Also checks product links against the requirements and records what was actually bought. Use for buying, replacing or choosing furniture, lamps, rugs, textiles or decor ("I need a new sofa", "is this rug right for the living room?", "I bought the chair"). Not for property.

## Should fire

| # | Prompt | Why it should fire |
|---|---|---|
| 1 | I need a new sofa for the living room. The old one is falling apart. | Replacing furniture, the Skill's key use and the description's own example. *Committed as `purchase-fires-1`* |
| 2 | Is this rug right for the living room? https://www.example-rugs.co.uk/hand-tufted-wool-rug-200x300 | A Listing to check against the Requirements, in the description's own words |
| 3 | The armchair we talked about arrived today. We went for the rust one in the end. | Fulfilment, with a likely Deviation, without the word "bought" |
| 4 | We're after a bedside lamp for the main bedroom: something warm to read by. | A lamp, with bulb and light Requirements until Lighting exists |
| 5 | What should we look for in a wardrobe? It has to get up our narrow stairs. | Access Requirements and a Full Guide, for something large |
| 6 | I'm going to the shops on Saturday for bedroom curtains. Can you give me something to take with me? | The Quick Guide, asked for without its name |
| 7 | The kitchen table is too small for the six of us now. Should we replace it? | Replacing an Item |
| 8 | I found an oak bookcase on sale: 90 cm wide, 35 deep, 200 tall, £240. Would it fit the living room alcove? | A Listing given as pasted details, not a link |
| 9 | Help me choose some cushions for the sofa. | Textiles, a small Purchase of a round or two |
| 10 | The hallway radiator leaks and needs replacing. What kind should we get? | A Feature, not an Item, bought to replace one |

## Near misses (should not fire)

| # | Prompt | Which boundary it tests |
|---|---|---|
| 1 | Here's a listing for a two-bedroom flat in Hackney at £525,000. Is it worth making an offer? | Buying property, in the Skill's own word "listing". *Committed as `purchase-skips-1`* |
| 2 | Can you write our grocery list for the week? Two adults and two cats. | A shopping list that isn't for the Home |
| 3 | Write a 300-word review of the headphones I bought last month, for my tech blog. | A product review, and "I bought" about something not for the Home |
| 4 | Our palette feels too beige. Can we add an accent colour? | Changing the Palette belongs to Color, even though Purchase applies it |
| 5 | What colour should we paint the hallway? | Paint and wall colors belong to Color |
| 6 | Add the bookcase we've had for years to the living room; I forgot it last time. | An Item already owned belongs to Home Intake |
| 7 | The living room is 4.2 m long, not 4. Can you fix that? | Correcting a measurement belongs to Home Intake |
| 8 | I don't know what style I like. Can you help me work it out? | The overall style belongs to Design Direction |
| 9 | Help me pick a laptop for work, under £1,000. | Buying something that isn't furniture, lamps, rugs, textiles, or decor |
| 10 | Compare mortgage rates for a £300,000 house for me. | Property finance |
| 11 | Should I buy shares in IKEA? | "Buy" and a furniture brand, about investing |

## Notes for the revision

- The should-fire set covers every stage of a Purchase's life: grilling a new one (1, 4, 5, 7, 9, 10), the Guides (6), Listings (2, 8), and Fulfilment (3). Prompt 3 is the least likely to fire, since it never says "bought"; if it misses, either add "arrived" to the description's example, or accept that the user names the Skill for it.
- Prompts 5 and 10 test the two things Purchase covers until later Skills exist: access through a narrow point, and a Feature rather than an Item. Prompt 4 tests lamps, which Purchase covers until Lighting exists.
- Near misses 1 to 3 are the brief's near misses (a real-estate listing, a grocery list, a product review), each using a word from the description ("listing", "list", "bought"). Near miss 1 is the closest, since "is it worth it?" reads like a Listing check.
- Near misses 4 and 5 test the Color boundary; 4 is the Palette question, and the closest, since a Purchase that needs a missing color hands it to Color in the same words. Near misses 6 to 8 test the other PoC Skills.
- Near misses 9 to 11 test "buy" outside the Home's design: a laptop (the description lists furniture, lamps, rugs, textiles, and decor), a mortgage, and shares in a furniture maker. Prompt 9 is arguable: a desk laptop is not decor, but a user in a Home Folder might want it placed. If it fires, decide whether it should.
- Color's near misses 5 and 6 ("which colour should the new sofa be", "a rug that works with our palette") are Purchase prompts. Now that Purchase exists, the next full trigger run shows whether they reach Purchase instead of Color.
