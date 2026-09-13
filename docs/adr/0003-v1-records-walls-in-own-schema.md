---
status: accepted
---

# v1 records Walls, in our own schema, so the 2D Floor Plan extends it

The v1 Home model is a Room list with no geometry, yet every Room already has its Walls in clockwise order, and windows and doors point at a Wall with an optional offset. We chose this over a plain length × width per Room because the 2D Floor Plan is the real target. With stable Walls, wall *i* later becomes the edge between corners *i* and *i+1*. Everything already attached to it (facing, windows, doors, Features, Items, and single-Wall Surfaces) then carries over instead of being entered again. We define our own schema, following the wall-reference pattern of Floorplanner, react-planner, and IFC, rather than adopting an existing format. IFC is far too heavy for a Room list. The navigation formats (IMDF, IndoorGML) have no walls or sill heights. Sweet Home 3D and the machine-learning datasets store windows by position only, with no link to a wall. See [floor-plan-formats.md](../research/floor-plan-formats.md).

## Consequences

- Every angle is assumed square until the 2D Floor Plan adds coordinates.
- Importing Apple RoomPlan scans and exporting IFC remain possible as later adapters.
