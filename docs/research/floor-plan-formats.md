# Floor-plan data formats (researched 2026-09-13)

This note covers the open 2D floor-plan formats that exist, how each one models Rooms, walls, openings, and Items, and what the v1 Room list must capture so that the 2D Floor Plan can extend it rather than replace it. Findings come from primary sources (specs, source code, first-party docs), listed at the end. One gap: magicplan's public docs don't show how a door or window is attached to a wall.

## Two ways to model a Room

- **Room as a polygon:** an ordered outline of corners. Used by IFC `IfcSpace` (a 2D `FootPrint` polyline) [1], IMDF `Unit` [21], Sweet Home 3D `room` [7], Floorplanner `area.poly` [11], magicplan `floorRoom` [13], and ResPlan [28].
- **Walls as a graph:** wall segments joined at shared corners, with Rooms as the faces they enclose. Used by react-planner (`vertices`, `lines`, `areas`) [12], Sweet Home 3D walls (`wallAtStart`/`wallAtEnd`) [7], Floorplanner walls [11], and Structured3D (junctions, lines, planes) [25].
- **Editors keep both.** Floorplanner derives areas "from closed wall spaces" [11]. Sweet Home 3D stores rooms and walls as separate lists with no link between them [7].

## How a window or door attaches to a wall

1. **Wall reference plus a position along it.** react-planner: `hole { line, offset }` [12]. Floorplanner: `wall.openings[]` with `t` (0–1 along the wall), `width`, `z` (elevation) and `z_height` [11]. IFC: `IfcWall` → `IfcRelVoidsElement` → `IfcOpeningElement` → `IfcRelFillsElement` → `IfcWindow`/`IfcDoor`, with the window's placement relative to the opening [2][3]. When a wall moves, the window moves with it.
2. **Absolute geometry plus a parent link.** RoomPlan gives each door and window its own `transform` and `dimensions`. Since iOS 17, `parentIdentifier` also names the wall ("the parent of a window is the wall surface on which the window rests") [17].
3. **Geometry only, no link.** Sweet Home 3D's `doorOrWindow` is a piece of furniture at x/y/angle, with a `boundToWall` flag but no wall id [7][8]. CubiCasa5K draws `Window`/`Door` as separate SVG polygons [24]. An IMDF `Opening` is a LineString that "MUST cover a single Unit boundary" [21]. OSM tags a door as a node shared by the room outlines [23].

Sill and head heights are explicit in Floorplanner (`z`, `z_height`), Sweet Home 3D (`elevation`, `height`), RoomPlan (transform plus dimensions), and IFC (placement plus `OverallHeight`). IMDF, OSM, CubiCasa5K, and RPLAN have no sill or head height.

## Comparison

| Format | Openness | Units / coords | Room | Opening → wall | Items | Multi-floor | Maturity |
|---|---|---|---|---|---|---|---|
| **IFC 4.3** (`IfcSpace`) | ISO-approved [6]; schema docs CC BY-ND 4.0 [6] | Per project (`UnitsInContext`) [5]; local placements | `IfcSpace` + 2D FootPrint; walls via `IfcRelSpaceBoundary` [1][4] | Wall → opening → filler (two relations) [2] | Furnishing elements (not checked) | `IfcBuildingStorey` [1] | The BIM exchange standard; heavy |
| **Sweet Home 3D** `Home.xml` | GPL app, published DTD [7][10] | cm internally [9] | `room` point list, not linked to walls | Furniture at x,y,angle; `boundToWall` flag; wall cut-out as % of the piece [8] | `pieceOfFurniture` x, y, elevation, width, depth, height, angle [7] | `level` (elevation, height) [7] | Mature desktop app, v7.5 (2025) [10] |
| **Floorplanner FML v3** | Proprietary, spec published | cm; x right, y down [11] | `area.poly`, generated from walls | `wall.openings[]`: `t`, `width`, `z`, `z_height` [11] | x, y, z, width, height, z_height, rotation, `refid` [11] | Project → floors → designs [11] | Commercial, with an API |
| **react-planner** | MIT [12] | `scene.unit` (default cm) [12] | `area` = vertex list; walls = `lines` | `hole { line, offset }` [12] | `item` x, y, rotation + properties [12] | `layers` with `altitude` [12] | JS library; small ecosystem |
| **magicplan Exchange XML** | Proprietary, partly documented | metres; walls on the centre line [13] | `floorRoom`: uid, type, points, x/y, rotation [13] | `door`/`window` are children of `floorRoom`; attachment undocumented | `furniture` child of `floorRoom` [13] | `plan` → `floor` (`floorType`) [13] | Commercial app; also exports IFC and USDZ [14] |
| **Apple RoomPlan** `CapturedRoom` | Proprietary framework; `Codable` | metres [20]; each room has its own frame | Walls and floors are `Surface`s (transform + dimensions; `polygonCorners` iOS 17) [16] | Own transform + `parentIdentifier` → wall (iOS 17) [17] | 16 `Object` categories, dimensions + transform [18] | `story` (iOS 17) [16]; `CapturedStructure` merges rooms [19] | Ships on LiDAR iPhones/iPads |
| **IMDF** | OGC Community Standard (2021), royalty-free [21] | GeoJSON, WGS84 lon/lat [21] | `Unit` polygon, `category: room` [21] | `Opening` LineString on a Unit boundary; no wall entity [21] | `Fixture` polygon, `category: furniture`; no dimensions or rotation [21] | `Level.ordinal` (0 = ground) [21] | Apple Maps indoor venues |
| **IndoorGML 2.0** | OGC standard, Part 1 (2025) [22] | Encoding-independent; 2D or 3D | `CellSpace` + dual-graph node | Boundary / graph edge | None | Multi-layer | Indoor-navigation niche |
| **OSM Simple Indoor Tagging** | ODbL data [23] | WGS84 | `indoor=room` closed way | Door node shared by room outlines and wall way [23] | Not standardised | `level=*` [23] | Community standard since 2014 |
| **CubiCasa5K** | CC BY-NC 4.0 [24] | Image pixels (SVG) | `Space` polygons, 65 room classes [24] | Separate `Window`/`Door` polygons; no link [24] | `FixedFurniture` icons, 51 classes [24] | No | Research dataset, 5,000 plans |
| **Structured3D** | Custom Terms of Use; code MIT [25] | mm, z up [25] | `semantics` → set of planes | Door/window = semantic plane set [25] | Not in the structure annotation | No | 3.5K synthetic house designs [25] |
| **RPLAN** | No redistribution [26] | 256×256×4 raster [26] | Per-pixel room labels | Not modelled as entities | None | No | 80,788 plans; research only |
| **House-GAN** | Code GPL-3.0 [27] | Bounding boxes | Room box + bubble-diagram adjacency [27] | None | None | No | Research |
| **ResPlan** | CC BY 4.0 [28] | px and metres [28] | Room polygons, 17 classes | Walls, doors, windows as geometry; `via_door`/`via_window` edges [28] | None | No | 17,000 plans (2025) |

## Adjacency

- **IFC** "2nd level" space boundaries: type 2a means an adjacent space. A `VIRTUAL` boundary is a divider that isn't a physical wall [4].
- **IndoorGML** turns rooms into graph nodes and boundaries into edges, for routing [22].
- **ResPlan** connectivity edges come in four types: `via_door`, `adjacency`, `direct`, `via_window` [28]. **House-GAN** uses a bubble diagram with room nodes and adjacency edges [27].
- **OSM:** "A door node is shared between the rooms which the door connects" [23].

## Bearing on the Home-model handoff questions

- **Units:** editors store one canonical unit and convert for display. Sweet Home 3D stores cm and converts through `LengthUnit` [9]. Floorplanner uses cm [11], while magicplan and RoomPlan use metres [13][20].
- **North and daylight:** the Sweet Home 3D `compass` element records `northDirection`, `latitude`, `longitude`, and `timeZone` [7]. IMDF is geographic by construction [21].
- **Open-plan spaces:** there are three precedents for one space holding several typed areas: IFC `VIRTUAL` boundaries [4], OSM `indoor=area` (a space not entirely enclosed by walls) [23], and RoomPlan `sections` ("one or more room types … in the room") [15].
- **Provenance:** RoomPlan stores a `confidence` on every surface and object [16][18].
- **Items:** every placement-capable format uses the same shape: width × depth × height, a position, and a rotation (Sweet Home 3D, Floorplanner, RoomPlan).

## What v1 must capture so the Floor Plan extends it

The idea is that v1 walls are the polygon's edges before the corners are known. Adding coordinates later then fills in geometry without restructuring anything.

1. **A Level above Room**, even for a one-floor Home. Every multi-floor format has one, and IMDF's `ordinal` convention (0 = ground floor) is a reasonable choice.
2. **Room:** stable id, name, type, shape (rectangle, L-shape, or other), and ceiling height. For a rectangle, length × width is enough.
3. **Walls per Room, in order:** a stable id per wall, listed in order around the Room (e.g. clockwise). In 2D, wall *i* becomes the edge from corner *i* to corner *i+1*, so the ids survive. Each wall has optional fields: length, compass facing, exterior or interior, and physical or virtual (the virtual kind handles open-plan spaces).
4. **Openings reference a wall:** each window, door, or opening has an id, `wallId`, width, height, sill height (windows), and an *optional* offset along the wall from its start corner. This is the Floorplanner and react-planner pattern. With the offset left empty, v1 still knows which wall an opening is on and how big it is. Store the offset as an absolute distance, not a 0–1 fraction: it's what the user measures, and it stays correct when a wall length is corrected. The fraction can be derived from it.
5. **Adjacency per wall:** `adjoins` = another Room, exterior, or unknown. A door between two Rooms records both of them. This is easy to collect in an interview, and the matched walls seed a shared-wall graph later.
6. **Canonical units:** one internal length unit, with the display unit stored separately.
7. **Item placement:** Room plus an optional `wallId` ("against the window wall") and width × depth × height now; x, y, and rotation later.

Safe to defer: coordinates, wall thickness, door swing, a shared-wall graph, and curved walls.

## Recommendation

**Define our own model, aligned with the wall-reference pattern** of Floorplanner, react-planner, and IFC: walls have stable ids, and openings name a wall plus an offset, width, sill, and head. None of the formats is worth adopting outright:

- **IFC** has the right concepts but is far too heavy for a Room list. It is a good export target later.
- **IMDF, IndoorGML, and OSM** are built for navigation. They use WGS84 coordinates or topology only, and have no wall entity, no sill height, and no Item dimensions.
- **CubiCasa5K, RPLAN, Structured3D, House-GAN, and ResPlan** are training datasets, not interchange formats, and several are non-commercial.
- **Sweet Home 3D** has no link from a room or a window to a wall.
- **Floorplanner and magicplan** are proprietary, and magicplan's window attachment is undocumented.
- **RoomPlan** is the most likely future import source (an iPhone scan). Its metres and `parentIdentifier` → wall map directly onto the model above.

## Sources

1. https://github.com/buildingSMART/IFC4.3.x-development/blob/master/docs/schemas/core/IfcProductExtension/Entities/IfcSpace.md
2. https://github.com/buildingSMART/IFC4.3.x-development/blob/master/docs/schemas/core/IfcProductExtension/Entities/IfcRelFillsElement.md
3. https://github.com/buildingSMART/IFC4.3.x-development/blob/master/docs/schemas/shared/IfcSharedBldgElements/Entities/IfcWindow.md
4. https://github.com/buildingSMART/IFC4.3.x-development/blob/master/docs/schemas/core/IfcProductExtension/Entities/IfcRelSpaceBoundary.md
5. https://github.com/buildingSMART/IFC4.3.x-development/blob/master/docs/schemas/core/IfcKernel/Entities/IfcProject.md
6. https://github.com/buildingSMART/IFC4.3.x-development (README: CC BY-ND 4.0, ISO-approved 4.3.2.0, https://www.iso.org/standard/84123.html)
7. http://www.sweethome3d.com/SweetHome3D.dtd
8. http://www.sweethome3d.com/javadoc/com/eteks/sweethome3d/model/HomeDoorOrWindow.html
9. http://www.sweethome3d.com/javadoc/com/eteks/sweethome3d/model/LengthUnit.html
10. https://www.sweethome3d.com/ ; https://www.sweethome3d.com/blog/2016/11/18/sweet_home_3d_5_3.html (Home.xml introduced in 5.3)
11. https://floorplanner.readme.io/reference/v30-specification
12. https://github.com/cvdlab/react-planner (MIT) ; https://github.com/cvdlab/react-planner/blob/master/src/models.js
13. https://apidocs.magicplan.app/guide/basic-concepts/plan-exchange-xml-format (and its `/floor` and `/room` pages)
14. https://help.magicplan.app/export-formats
15. https://developer.apple.com/documentation/roomplan/capturedroom
16. https://developer.apple.com/documentation/roomplan/capturedroom/surface (incl. `category`, `polygonCorners`, `story`)
17. https://developer.apple.com/documentation/roomplan/capturedroom/surface/parentidentifier
18. https://developer.apple.com/documentation/roomplan/capturedroom/object (incl. `Category`)
19. https://developer.apple.com/documentation/roomplan/capturedstructure
20. https://developer.apple.com/forums/thread/707998 (dimensions are width, height, length in metres)
21. https://docs.ogc.org/cs/20-094/index.html (and its `/Unit`, `/Opening`, `/Level`, `/Fixture` pages)
22. https://docs.ogc.org/is/22-045r5/22-045r5.html ; https://www.ogc.org/announcement/ogc-publishes-indoorgml-2-0-part-1-conceptual-model-standard/
23. https://wiki.openstreetmap.org/wiki/Simple_Indoor_Tagging
24. https://github.com/CubiCasa/CubiCasa5k (LICENSE; `floortrans/loaders/house.py`) ; https://arxiv.org/abs/1904.01920
25. https://github.com/bertjiazheng/Structured3D/blob/master/data_organization.md ; https://structured3d-dataset.org/
26. https://arxiv.org/html/2407.15723v1 (quotes RPLAN's format and redistribution terms) ; http://staff.ustc.edu.cn/~fuxm/projects/DeepLayout/index.html
27. https://github.com/ennauata/housegan
28. https://arxiv.org/abs/2508.14006 (ResPlan)
