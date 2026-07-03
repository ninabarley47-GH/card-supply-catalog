# Product Backlog

## Discovery

### Similar Packs Based on Multiple Attributes

Instead of only color:

- shared colors
- shared tags
- same collection
- same designer

---

## Cataloging

### Auto-fill Previous Values

Consider remembering:

- Owner
- Release Year
- Status

to speed repetitive data entry.

# Technical Backlog

## Ownership Model

### Separate Paper Packs from Ownership

**Status:** Future Investigation

### Background

Initially, supporting multiple owners could be accomplished by duplicating paper pack records and assigning a different owner to each copy.

After discussion, this approach was rejected because it would duplicate shared metadata and create unnecessary maintenance. Updates to colors, tags, images, or other shared information would need to be made in multiple places.

### Proposed Direction

Treat the paper pack as a single shared entity.

Store owner-specific information separately.

Shared paper pack data would include:

- Name
- Images
- Colors
- Tags
- Release information
- Pattern count

Owner-specific data would include:

- Owner
- Inventory status (Available / Used Up)
- Favorite
- Personal notes
- Storage location
- Other user-specific metadata

### Benefits

- One authoritative record for each DSP.
- Eliminates duplicate maintenance.
- Allows multiple owners to share the same paper pack definition.
- Supports future filtering by owner without duplicating packs.

### Notes

Current implementation continues to use a single owner per paper pack. This item should only be revisited if multiple-owner support becomes a project goal.

## Image Storage

### Durable Local Image Storage
Current prototype uses IndexedDB.

Future version should evaluate storing images as local files with database references.

Reason:
- Better scalability
- Easier backup
- Less database bloat

---
