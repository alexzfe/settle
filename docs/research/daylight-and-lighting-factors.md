# Daylight and lighting factors for color advice (researched 2026-09-13)

Which Room, window, and artificial-light facts actually change the color and lighting advice a designer gives, how precisely each must be known, and whether a lay user can supply it. The goal is the minimum a Room record must hold. Findings come from the sources listed at the end. Where only a secondary summary was reachable (BR 209 and EN 17037 are paywalled), this is noted. Lines marked *inference* are our reasoning, not a sourced claim.

## Summary table

Effect: how much the factor changes the advice. Record: **Must** means advice is poor without it, **Should** means it is cheap and improves advice, **Derive** means compute it rather than ask for it, and **Skip** means it is not worth recording.

| Factor | Effect | Precision needed | Lay user can supply? | Record |
|---|---|---|---|---|
| Window compass orientation | **High** | 8-point compass | Yes (phone compass, map, or Blueprint north arrow) | Must, per window |
| Hemisphere | **High** (flips N/S) | Sign of latitude | Implied by location | Derive |
| Latitude | Medium (scales orientation and the seasonal swing) | City level (±1° is plenty) | Yes | Must (as city) |
| Time-of-day Room usage | **High** for E/W rooms and rooms used after dark | Coarse slots (morning, afternoon, evening) | Yes | Must |
| External obstructions | Medium–High (can remove direct sun entirely) | 3 levels, plus a "deciduous trees" flag | Yes, with a guided question | Should |
| Floor level | Low directly (a proxy for obstruction); High for basements | Storey number | Yes | Should |
| Window size / glazing ratio | Medium (amount of light, not its color) | Width × height to ~10–20 cm, or a size bucket | Yes (tape or Blueprint) | Should |
| Window head height | Medium (sets daylight depth) | ~10 cm | Yes | Should |
| Sill height | Low | – | Yes | Skip (optional) |
| Room depth vs window | Medium–High (the dark back of a deep Room) | ~0.25 m | Yes (already a Room dimension) | Must |
| Glass type | Low for clear or low-e glass; High only if tinted, filmed, or obscured | Exception flag | Mostly | Should (flag only) |
| Bulb CCT | **High** after dark | Kelvin on the pack, or warm/neutral/cool | Mostly (printed on the pack) | Must, per fixture |
| Bulb CRI | Medium (reds, near-neutrals) | <80 / 80s / 90+ | Often unknown (assume 80) | Should |
| Dimmer / dim-to-warm | Low–Medium | Two flags | Dimmer yes; dim-to-warm sometimes | Should |
| Fixture layer (ambient/task/accent) | Medium | Role per fixture | Yes | Should |
| Paint LRV | **High** in dim or deep Rooms | Look up from the paint code | No, and it doesn't need to be asked | Derive |

## Daylight factors

### Compass orientation and the hemisphere flip

- **Paint makers organise their advice by aspect.** Farrow & Ball: north light "tends to bring out the cooler tones within a colour", south rooms get "warm light from dawn until dusk", west rooms are "cooler in the morning and brighter in the afternoon", and east rooms get "most sun in the morning and cooler, muted light in the evening" [1]. Benjamin Moore describes north light as "muted" and consistent, and south light as "strong" and "warmer" [3][4]. The Benjamin Moore CE course calls north light "diffuse and cool" [5].
- **The rule is a fork, not a formula.** For a north room, Farrow & Ball offers two opposite strategies: counter it with yellow-based colors, or embrace it with dark colors for a cocooning feel [1]. The orientation defines the light problem, and the Design Direction or Room Direction picks the strategy.
- **The southern hemisphere mirrors it.** Resene (NZ): north-facing rooms get "intense sun and glare" and suit "cooler, denser colours", while south-facing rooms have light that is "cool, grey or sour", where "no amount of pale tints or white will make these rooms appealing" [2]. The platform must store the true compass direction and derive the hemisphere from the Home's location. A "sunny side" field would lose information.
- **8-point precision is enough** (our calculation using NOAA sun geometry [6]; clear sky, no obstructions, sun above 5°). At 51.5°N on the equinox, direct sun reaches a window for S 10.9 h, SE/SW 8.0 h, E/W 5.5 h, NE/NW 2.9 h, and N 0 h. Rotating a south window by 10° costs 0.3 h, and by 22.5° costs 1.3 h. At the December solstice S, SE, and SW all get 6.1 h. At 34°S the table mirrors exactly (N 11.2 h, S 0 h). A ±22.5° error never moves a window into a different advice category. Degree-level precision would only matter for sun-hour simulation, which the advice doesn't need.
- **Orientation belongs to a window, not a Room.** Dual-aspect Rooms are common. Recording which wall each window is on also keeps v1 forward-compatible with the Floor Plan (*inference*).
- Paint guidance means the direction the window faces, i.e. what you look toward out of it. Ask it that way, because "north-facing room" is easy to confuse with "room on the north side" (*inference*). A phone compass reads magnetic north, but the offset is small compared with a 45° bin in most populated areas (*inference*).

### Latitude, sun angle, day length, seasons

- Noon sun altitude = 90° − |latitude − declination|, where declination runs from −23.44° to +23.44° over the year [6]. Computed values:

  | Latitude | Noon altitude Dec / Jun | Day length Dec / Jun |
  |---|---|---|
  | 0° | 66.6° / 66.6° | 12.0 h / 12.0 h |
  | 20° | 46.6° / 86.6° | 10.8 h / 13.2 h |
  | 40° | 26.6° / 73.4° | 9.2 h / 14.8 h |
  | 51.5° (London) | 15.1° / 61.9° | 7.6 h / 16.4 h |
  | 60° | 6.6° / 53.4° | 5.5 h / 18.5 h |

- **Latitude scales the orientation effect rather than changing its direction.** At high latitude, a low winter sun reaches deep into equator-facing Rooms, and pole-facing Rooms get no direct sun for months. In summer, though, a north window at 51.5°N gets about 5.8 h of low early- and late-day sun, so "north rooms never get sun" is false in June. In the tropics (below 23.44°) the sun passes overhead and sits on the "wrong" side for part of the year, so the N/S rule weakens and E/W dominates (derived from [6]).
- **Seasonal color shift is real.** Benjamin Moore: winter light is "sharper and cooler in cast", and summer light renders "an amber cast on the same exact paint color" [3].
- **City-level precision is far more than enough.** One degree of latitude is about 111 km and moves the noon sun by 1°. Precise coordinates add privacy cost and no benefit (*inference*).
- **Daylight color varies widely.** Measured daylight and skylight span CCTs from 3000 K to 10⁶ K [16]. At Granada, 5700 K "best typifies" daylight, with clear-sky chromaticities at high CCTs (>9000 K) [15]. This is the physical basis for "north light is blue": a north window sees only skylight, never direct sun.

### Obstructions and floor level

- BR 209 screening rule: if an obstruction subtends less than **25°** above the horizontal, measured from the centre of the lowest window, diffuse daylight "is unlikely to be significantly affected" [7][8]. A window is "adequately lit" at a Vertical Sky Component of 27% or more. For sunlight, windows "within 90° of due south" (UK) should keep 25% of annual probable sunlight hours, with 5% in winter [8].
- In practice: a building opposite exceeds 25° once it rises above the window by more than about half its distance away (tan 25° ≈ 0.47; *inference*). A heavily obstructed south Room behaves like a north Room for color: diffuse, cooler, no direct sun.
- **What to record:** a three-level category (open, partly obstructed, heavily obstructed or building close opposite), plus a seasonal flag for deciduous trees. A lay user can answer "standing at the window, how much sky do you see above the buildings or trees opposite?" (*inference*).
- **Floor level** matters mainly as a proxy for obstruction, so record it cheaply as a storey number. Basement or lower-ground Rooms are a strong signal on their own.

### Window size, head and sill height, Room depth

- **Glazing ratio sets the amount of light, not its color.** In simulations at 35°S, a window-to-floor area of 10% gave a minimum of about 100 lux. A daylit depth of up to 2.5× the window head height, or a 20% window-to-floor ratio, gave at least about 200 lux under an overcast sky [10]. For comparison, the US IRC minimum for habitable rooms is 8% glazing [11]. EN 17037's minimum is 300 lux over 50% of the space for half of daylight hours, plus 100 lux over 95%; its sunlight levels are 1.5, 3, and 4 h on a reference day between 1 February and 21 March (via secondary summaries [9]).
- **Head height sets daylight penetration.** Published rules put the maximum well-lit depth at 1.5–2.5× the window head height, and "2.5 times for residential spaces" [10]. Nonstandard sill heights and high-level windows break these rules [10]. Otherwise sill height matters little for color advice.
- **The no-sky line.** BR 209 (2011) asked that no more than 20% of the working plane lose sight of the sky. The 2022 edition no longer requires this for new developments (secondary [8]). The BRE limiting-depth criterion is usually given as L/W + L/H ≤ 2/(1 − R_b), where R_b is the average reflectance of the rear half of the room (secondary; verify against BR 209 before coding it).
- **Room depth ÷ head height is the useful derived number.** Above about 2.5, the back of the Room is daylight-poor. That changes the advice toward higher-LRV rear surfaces, lighter ceilings and floors, or accepting the dark and relying on artificial light (*inference* from [10] and the reflectance terms below).

### Glass type

- Ordinary clear and modern low-e double glazing is close to neutral. For example, Pilkington Optitherm S3 low-e has 82% light transmittance and is marketed as "super neutral" [12]. Vitro rates low-iron glass above Ra 95 and neutral grey tints high, with tinted or colored glass "more likely to feature a lower CRI" [13].
- Measured glazings showed a CIE CRI of 80–95 and transmitted CCT from 2,339 K to 7,964 K. Laminated glazing performed worst for color [14].
- **What to record:** an exception flag only (tinted, solar film, laminated or colored, obscured or frosted). A full glass spec is not worth asking for.

### Time-of-day usage

- Paint makers tie east and west advice directly to when the Room is used [1]. Resene qualifies its south-room advice as applying to rooms "used during the day" [2].
- A Room used mostly after dark, such as a bedroom or a commuter's living room, should be designed against its bulbs rather than its daylight (*inference*). Record coarse slots (morning, midday, afternoon, evening) per Room.

## Artificial light

- **CCT sets the color cast at night.** "Halogen and incandescent bulbs emit yellow light, which makes wall colours appear warmer, while cool white bulbs tend to give off a bluer light" [1]. Under incandescent light, yellows and creams glow while "blues and lavender" turn grey [2]. Residential white LEDs are typically 2700–3000 K [18].
- **Don't encode the Kruithof curve (warmer light at lower light levels) as fact.** A review of the credible studies found that "variation in CCT has a negligible effect on ratings of brightness and pleasantness". What matters is avoiding low light levels: below about 300 lux can feel unpleasant, and 500 lux is enough [19]. CCT is a lever for appearance and style, not a comfort rule.
- **CRI.** DOE: "a CRI in the 70s would be considered acceptable for interior applications, whereas the 80s would be considered good and the 90s excellent". R9 covers saturated reds. "Two light sources with the same CCT and CRI may not render colors the same way", and CRIs should not be compared across very different CCTs [17]. At 2700 K, an incandescent lamp scores CRI 100 while a typical LED scores about 80, which visibly changes reds [5]. DOE's rule of thumb is at least 80 [18].
- **Metamerism** ("two colors that look identical under one light source look different … under another") hits near-neutrals, greys, and grey-blues hardest [5]. These are exactly the colors a warm-minimal palette leans on.
- **Dimmers.** Ordinary LEDs keep a "relatively stable CCT" when dimmed. Incandescent bulbs and dim-to-warm LEDs shift warmer, "down to as low as 1800K". Tunable-white products span about 2700 K to 5000–6500 K [18]. So "dimmable" alone doesn't change color; dim-to-warm or tunable does.
- **Layers (ambient, task, accent).** The IES residential recommended practice is RP-11-20 [20] (its content was not accessed). For color, the fixture's role and direction decide which surfaces are lit. An uplighter makes the ceiling finish part of the light source, and a single central pendant lights walls weakly (*inference*). Record a role per fixture. Fixtures are Items.

## Paint LRV: where paint meets light

- LRV is the percentage of visible light a surface reflects, 0–100. In practice it runs from about 5 (deepest black) to about 90 (brightest white). The ASHRAE figures quoted are ceilings ≥80%, walls ≥50%, and floors ≥20% [5]. It is the CIE Y value under D65 (BS 8493, secondary [21]). Manufacturers publish it for every color [5].
- **LRV is the quantitative link to daylight.** In the average daylight factor formula, DF = τ·A_g·θ / (A·(1 − R²)), R is the average interior reflectance and θ is the visible sky angle (so obstruction enters here too) [10]. Moving R from 0.5 to 0.3 cuts the daylight factor by about 18%, and raising it to 0.7 adds about 47%. Painting only the walls moves R by less, because the floor, ceiling, and furniture count too (our arithmetic on [10]). The limiting-depth criterion above uses the rear-half reflectance R_b in the same way.
- **Accessibility.** Adjacent surfaces that need visual contrast should differ by at least 30 LRV points (BS 8300, secondary [21]). This matters for an older or visually impaired household (a possible Constraint).
- **What to record:** the paint brand and color code. Look LRV up; never ask the user for it.
- **Sampling stays irreplaceable.** Resene says to paint an A2 card, move it between walls, and watch it through the day [2]. Benjamin Moore also says to sample at different times of day [5]. The AI can tell the user *which* times to check, based on the Room's usage slots (*inference*).

## Consequences for us

Minimum data for good color and lighting advice:

- **Home:** location at city level (gives hemisphere, latitude, day length). Take the building's north arrow from the Blueprint when there is one.
- **Room:** depth from the window wall, ceiling height, storey, and usage time slots.
- **Window (per window, on a named wall):** 8-point facing; approximate width × height or a size bucket; head height; obstruction level (3 levels plus a deciduous flag); a glass exception flag.
- **Lighting fixture (an Item):** layer role, CCT (Kelvin or warm/neutral/cool), CRI if known (default 80), a dimmer flag, and a dim-to-warm/tunable flag.
- **Surfaces:** paint brand and color code (LRV is looked up), and finish.
- **Derive, don't ask:** hemisphere, which side is sunny, direct-sun hours by season, the depth/head-height ratio, and average reflectance.
- **Skip:** degree-level orientation, GPS coordinates, sill height, glass performance specs, VSC and daylight simulations.

## Sources

1. Farrow & Ball, "How light affects colour": https://www.farrow-ball.com/us/how-to-guide/how-light-affects-colour
2. Resene, "Why the same colour looks different in different rooms" (NZ): https://www.resene.co.nz/homeown/use_colr/colour-by-compass.htm
3. Benjamin Moore, south-facing room colors: https://www.benjaminmoore.com/en-us/color-overview/color-palettes/color-by-direction/south-facing-room-paint-colors
4. Benjamin Moore, north-facing room colors: https://www.benjaminmoore.com/en-us/color-overview/color-palettes/color-by-direction/north-facing-room-paint-colors
5. Benjamin Moore CE course, "The Science of Light and Its Impact on Paint Color Specification and IEQ": https://continuingeducation.bnpmedia.com/architect/courses/benjamin-moore/the-science-of-light-and-its-impact-on-paint-color-specification-and-ieq/
6. NOAA Global Monitoring Laboratory, Solar Calculator glossary (declination, azimuth): https://gml.noaa.gov/grad/solcalc/glossary.html
7. BRE, BR 209 *Site layout planning for daylight and sunlight* (2022, paywalled): https://www.thenbs.com/PublicationIndex/documents/details?Pub=BRE&DocID=298581
8. Secondary summaries of BR 209: https://www.righttolightsurveyors.co.uk/45-degree-and-25-degree-lines-rules-of-thumb/ , https://www.ansteyhorne.co.uk/news/understanding-bre-209-2022 , https://www.linkedin.com/pulse/appendix-c-br209-site-layout-planning-daylight-sunlight-peter-defoe
9. EN 17037:2018 *Daylight in buildings* (paywalled): https://standards.iteh.ai/catalog/standards/cen/836e5b91-1eb0-4643-a2ba-7ca5a5988e64/en-17037-2018 ; summaries: https://buildingtalk.com/wp-content/uploads/Velux-White-Paper-Guide-to-Daylighting-and-EN-17037.pdf , https://help.iesve.com/ve2025/10_4_exposure_to_sunlight_hours.htm
10. Nik Ibrahim & Hayman, "Daylight design rules of thumb", CIB conference 2005 (includes Littlefair's ADF formula): https://www.irbnet.de/daten/iconda/CIB_DC23487.pdf
11. ICC, 2021 IRC R303.1 Habitable rooms: https://codes.iccsafe.org/s/IRC2021P2/part-iii-building-planning-and-construction/IRC2021P2-Pt03-Ch03-SecR303.1
12. Pilkington Optitherm S3: https://www.pilkington.com/en/gbl/architectural-and-technical-glass/product-categories/thermal-insulation/pilkington-optitherm-s3
13. Vitro Glass, "Color Rendering Index: How Glass Affects Color Rendering": https://glassed.vitroglazings.com/topics/color-rendering-index-how-glass-affects-color-rendering
14. Dangol, Kruisselbrink & Rosemann, "Effect of Window Glazing on Colour Quality of Transmitted Daylight", *Journal of Daylighting* 4 (2017): https://solarlits.com/jd/4-37
15. Hernández-Andrés, Romero et al., "Color and spectral analysis of daylight in southern Europe", *JOSA A* 18(6) (2001): https://opg.optica.org/josaa/abstract.cfm?uri=josaa-18-6-1325
16. Hernández-Andrés, Lee & Romero, "Calculating correlated color temperatures across the entire gamut of daylight and skylight chromaticities", *Applied Optics* 38(27) (1999): https://opg.optica.org/ao/abstract.cfm?uri=ao-38-27-5703
17. US DOE, "LED Color Characteristics" fact sheet: https://www.energy.gov/sites/prod/files/2014/04/f14/led-color-characteristics-factsheet.pdf
18. US DOE, "Understanding LED Color-Tunable Products": https://www.energy.gov/cmei/ssl/understanding-led-color-tunable-products
19. Fotios, "A Revised Kruithof Graph Based on Empirical Data", *LEUKOS* 13(1) (2017): https://www.tandfonline.com/doi/full/10.1080/15502724.2016.1159137 (open copy: https://eprints.whiterose.ac.uk/id/eprint/98531/17/Fotios_2017_a_new_Kruithof_graph.pdf)
20. IES RP-11-20, *Lighting for Interior and Exterior Residential Environments*: https://store.ies.org/product/rp-11-20-recommended-practice-lighting-for-interior-and-exterior-residential-environments/
21. SATRA on LRV measurement (BS 8493) and BS 8300 contrast (secondary): https://www.satra.com/spotlight/article.php?id=426
