2026-07-01

# Decision 1:
Remove Quantity Tracking

Reason:
Users care whether paper is still usable,
not how many packs they own.

Result:
Availability + Backup Supply
replaced quantity.

# Decision 2:
Use four large pattern thumbnails on every DSP card.

Reason
Users recognize DSP packs visually. Large previews make browsing faster and more enjoyable than text-heavy cards.

Impact
This became the standard layout for the Library screen.

# Decision 3
Do not implement a "Low" availability state.

Reason
The application is intended to support real crafting habits, not detailed inventory management. The user is unlikely to maintain a granular status.

Impact
Availability is simplified to:
- Available
- Used Up

# Decision 4
Cards are always opened by clicking the card.

Reason
This makes it easy to see larger images of the paper and get more detailed metadata about the paper pack

Impact
Makes it easy to compare paper packs, but also to get details about an individual pack

# Decision 5
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
The catalog view is for visual recognition and creative inspiration. Every card should prioritize pattern thumbnails and the complete color palette. Secondary metadata should never reduce the visibility of those two elements.

# Decision 7
Nothing stores colors by name. Everything stores a color ID. The color ID will be based on the color name. For example, if the color is "Basic Beige", the color ID is "basic-beige". Corresponding to this color ID, the CSS should also contain a color variable name.

# Decision 8
We want to show all the colors on the catalog cards, with the colors represented by a dot showing the color, followed by the color id. These should be presented in columns. The cards should adapt to the available space. Let CSS decide how many cards per column on the page, and how many columns of colors to display based on the card width.
