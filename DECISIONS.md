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
Scenery
Floral
Foliage
Water
Land Animals
Flying Animals
Ocean Animals
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

# Decision 12
## Every Feature Must Support a Crafting Decision

The primary purpose of the application is to help users choose supplies for a project.

Metadata, navigation, and new features should exist only if they help users:
- discover suitable paper,
- compare options,
- coordinate supplies,
- or efficiently maintain the catalog.

Administrative features should remain in maintenance workflows rather than the primary browsing experience.

# Decision 13
## Carrying Coordinating Colors Into Detail Pages
When a user clicks a pack from the coordinating color, the pack clicked should display in the details page, and the packs that match the previously selected coordinating color should display in the color coordination section.

# Decision 14
## Discovery over Search

Whenever practical, the application should encourage visual discovery rather than requiring users to remember names, collections, or metadata.

Relationships between paper packs should be exposed naturally through colors, tags, themes, and other shared characteristics.

# Decision 15
## Closing the Detail Page

The user's natural behavior is to click off the detail screen rather than to click the close button. Clicking outside the detail panel should close the details screen as an alternate behavior to clicking the X to close it.

# Decision 16
## Card Context Bar

Temporary or user-specific states are displayed as a single context bar above the paper pack card.

The context bar communicates the current browsing context (such as Recently Added or Favorite) without obscuring the paper artwork or adding decorative badges to the card.

Only one context bar is displayed on a card at any time.

# Decision 17 
## Prototype Image Storage

During the prototype cataloging workflow, selected DSP images may be stored as data URLs in browser localStorage.

This is acceptable only for early testing because it keeps the Add DSP workflow simple.

A future storage milestone should replace this with a durable local image-file strategy so larger paper pack collections do not overload localStorage.

# Decision 18
## Image Storage Solutions
We need to establish a place to store paper images that is accessible to all the users using this app, even if they don't live together. 

Instead of storing image data inside the browser database, the catalog would store image references like:
{
  "id": "pattern-1",
  "imageName": "velvet-meadow-01.jpg",
  "imagePath": "Images/Velvet Meadow/velvet-meadow-01.jpg"
}
Then the app displays the image from that path.

Ultimately, we want to move toward using an app-managed shared image folder in OneDrive, but store stable image URLs or relative cloud paths in the catalog. 

Then the app resolves that path against a configured shared OneDrive folder.

# Decision 19
## Search and Filter Location
The catalog gets more room. Moving the filters out of the content area lets your featured pack and "Recently Added" section breathe. Right now the filter controls consume the upper-right corner, forcing the content down.

2. It scales naturally. It allows filters to expand beyond search and tags to Owner, Color family, Individual colors, Release year, Retired/current and Favorites. The sidebar can grow without making the main page feel crowded.

3. It matches how people expect catalog apps to work.

# Decision 20
## Filtering Architecture

The catalog uses a unified filtering pipeline.

All user constraints (search text, tags, owner, color family, release year, etc.) are evaluated together to determine the visible pack list.

Search is treated as a free-text filter rather than a separate search mechanism.

Each change to the filter state re-evaluates the full catalog rather than filtering an already filtered subset.

# Decision 21
## Catalog State Behavior

Opening a pack detail view does not reset the catalog.

Users can search, filter, open a detail view, compare matching packs by color, and return to the catalog with the same filtered results still active.

# Decision 22
## Unified Filtering

The catalog uses a single filtering pipeline.

Search is treated as a free-text filter.
Tags, colors, owners, release year, and future filters are evaluated together.

Whenever any filter changes, the visible catalog is recalculated from the complete catalog rather than from an already-filtered subset.

Reason:
Keeps filter behavior predictable and makes future filters easy to add.

Impact:
All filtering logic lives in one place.

# Decision 23
## Similar Packs as Detail-Level Filtering

The “Similar Packs” area in the detail view functions as a focused, contextual mini-filter.

It does not replace the main catalog filters. Instead, it helps users pivot from one open pack to other packs that share a selected color or related attribute.

This supports the crafting workflow: start with one pack, then quickly discover coordinating packs.

# Decision 24
## Adding Colors
When adding a new paper pack if the app finds a color that doesn't exist in the catalog, the user should be prompted to add the missing color.

Once the color is added, the user should return to the Add or Edit DSP screen and be allowed to continue with their edits there.

This functionality should be able to be reused in the "Add Color" section of the Settings tab.
