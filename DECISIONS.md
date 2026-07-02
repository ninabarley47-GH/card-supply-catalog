July 2026

# Decision 1:
## Quantity Tracking

Remove Quantity Tracking

Reason:
Users care whether paper is still usable,
not how many packs they own.

Result:
Availability + Backup Supply
replaced quantity.

# Decision 2:
## Pattern Thumbnails

Use large pattern thumbnails on every DSP card to display all the patterns for that paper pack.

Reason
Users recognize DSP packs visually. Large previews make browsing faster and more enjoyable than text-heavy cards.

Impact
This became the standard layout for the Library screen.

# Decision 3
## Availability States

Do not implement a "Low" availability state.

Reason
The application is intended to support real crafting habits, not detailed inventory management. The user is unlikely to maintain a granular status.

Impact
Availability is simplified to:
- Available
- Used Up

# Decision 4
## Card Behavior
Cards are always opened by clicking the card.

Reason
This makes it easy to see larger images of the paper and get more detailed metadata about the paper pack

Impact
Makes it easy to compare paper packs, but also to get details about an individual pack

# Decision 5
## Keywords

Keywords are the following:
Background
Floral
Foliage
Ocean
Mammals
Winged Creatures
Hobbies
Specialty
Textures
Holiday
Geometric

Reason
This provides a basic set of categories that users will commonly want to search or filter by, without being overwhelming.

Impact
Makes it easy to label paper for filtering

# Decision 6
## Catalog View Purpose

The catalog view is for visual recognition and creative inspiration. Every card should prioritize pattern thumbnails and the complete color palette. Secondary metadata should never reduce the visibility of those two elements.

# Decision 7
## Color IDs and Names
Nothing stores colors by name. Everything stores a color ID. The color ID will be based on the color name. For example, if the color is "Basic Beige", the color ID is "basic-beige". Corresponding to this color ID, the CSS should also contain a color variable name.

# Decision 8
## Color Display

We want to show all the colors on the catalog cards, with the colors represented by a dot showing the color, followed by the color id. These should be presented in columns. The cards should adapt to the available space. Let CSS decide how many cards per column on the page, and how many columns of colors to display based on the card width.

# Decision 9
## Left Nav

The left nav should be very simple. It should only include Library and Settings. 

Settings would allow the user to add a color or add a new paper pack. 

Library shows the overall catalog. 

# Decision 10
Clicking a pattern pack from the Library will display a larger, detailed view of the pack, and will provide a feature to allow edits to the pack.

# Decision 11
## Recently Added

The "Recently Added" section represents the most recent cataloging session, not a rolling date range.

- It displays all DSP packs added during the latest cataloging session.
- The section remains unchanged until a newer cataloging session occurs.
- It does not expire simply because time passes.
- "Recently Updated" is intentionally omitted, as edits are considered maintenance rather than a primary browsing workflow.
- "Recently Added" is presented as a collapsible section at the top of the Library view rather than as a permanent item in the left navigation.