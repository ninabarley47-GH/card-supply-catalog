Last Updated: 2026-08-02

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
Illustration
Scenery
Floral
Foliage
Water
Words
Land Animals
Flying Animals
Water Animals
Hobbies
Food
Masculine
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
Paper packs store color IDs rather than color names. A color ID is based on the color name; for example, "Basic Beige" uses `basic-beige`. `data/colors.json` is the authoritative source for names, HEX values, families, collections, status, aliases, and product metadata. Color swatches use that data directly; a separate CSS variable is not required for every catalog color.

# Decision 8
## Color Display

Show all coordinating colors on catalog cards as a color dot followed by the human-readable color name. Present them in responsive columns and let CSS adapt both the card grid and color layout to the available width.

# Decision 9
## Left Nav

The left navigation remains simple and contains Paper Library, Color Library, and Settings. Add DSP and Add Color are global actions in the app header. Search and catalog filters live in the left sidebar, which remains visible while the desktop library scrolls. On narrow screens it returns to the normal document flow.

# Decision 10
Clicking a pattern pack from the Library will display a larger, detailed view of the pack, and will provide a feature to allow edits to the pack.

# Decision 11
## Recently Added

"Recently Added" is a persistent per-pack status, not a date range or cataloging session.

- Every newly added DSP pack receives `recentlyAdded: true`.
- Recently added available packs sort before other available packs.
- Each affected card displays a green context bar.
- The user clears the status permanently with the control on that bar.
- Editing a pack preserves its current status.
- The status does not expire with time, and there is no separate Recently Updated state.

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
## Browser Image Fallback

When a selected image-library folder is unavailable or unsupported, images may be embedded as data URLs in paper-pack records stored in IndexedDB. This is a compatibility fallback, not the preferred durable image strategy. Legacy localStorage catalog data is migrated into IndexedDB.

# Decision 18
## Image Storage Solutions
We need to establish a place to store paper images that is accessible to all the users using this app, even if they don't live together. 

Instead of storing image data inside the browser database, the catalog would store image references like:
{
  "id": "pattern-1",
  "imageName": "velvet-meadow-01.jpg",
  "imagePath": "Velvet Meadow/velvet-meadow-01.jpg"
}
Then the app displays the image from that path.

The implemented preferred strategy is a user-selected local folder, which may be inside a locally synced OneDrive folder. The catalog stores stable relative `imagePath` references and resolves them against the selected directory handle. The app can check the library, reconnect it, migrate embedded images, repair broken links, auto-load a matching pack folder, and find uncataloged folders. Direct OneDrive API integration is not required.

# Decision 19
## Search and Filter Location
Moving search and filters into the left sidebar gives the catalog more room and keeps the Library header focused on results and library-specific actions.

It scales naturally. Filters can expand without pushing the paper cards farther down the page.

It also matches how people expect catalog applications to work.

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

# Decision 25
## Backup and Restore
Provide user-triggered JSON export and import for colors, paper-pack metadata, and image references or embedded images. Standard exports retain relative folder references; iPad exports embed compressed images. When a writable image-library folder is selected, exports are saved there, with browser download as the fallback. Folder-backed image files must still be backed up or shared with the JSON.

# Decision 26
## Add User-Selected Image Library Folder
On supported desktop browsers, let the user choose an image library folder using the File System Access API. This is the most natural fit for local-first image storage.

Pros:
Works offline.
Images are real files.
Easy to back up.
Easy to inspect manually.
Can live inside OneDrive/Dropbox/iCloud/Google Drive desktop sync folders.
Catalog stores stable relative paths instead of huge image blobs.

Important limitation:
The File System Access API is not universally supported. Can I Use currently shows support mainly in Chromium desktop browsers, with no support in Safari/iOS Safari or Firefox. showDirectoryPicker() is also marked by MDN as limited availability and experimental. Sources: Can I Use File System Access API, MDN showDirectoryPicker().

# Decision 27
## Cloud-Synced Local Folder

For future sharing, the best practical route is not direct OneDrive API integration yet. Instead:
User chooses a folder that happens to live inside OneDrive.
App writes/reads normal local files.
OneDrive syncs the folder for sharing.
Another user opens the same synced folder on their own computer.
This keeps the app local-first and avoids requiring internet at runtime. The app works offline against the local synced copy; OneDrive only handles background synchronization.
Caveat:
This depends on each user having the shared folder synced locally. A browser cannot reliably read arbitrary remote OneDrive URLs as a folder.

# Decision 28
## IndexedDB for Writable Catalog Data

IndexedDB is the canonical writable store for paper-pack records, deletion markers, user-added colors, and settings. Bundled JSON files provide the base catalog and color data, which are merged with saved browser data at startup. Embedded image data may also live in IndexedDB as a compatibility fallback, while a selected folder remains the preferred canonical image library.

# Decision 29
## Incremental Backup File Loading

Provide a feature where you can load backup files incrementally. This allows a user to leverage another user's DSP creation in the app without overlaying any tagging or ownership they've already done.

# Decision 30
## Card Library Decisions
1. no card titles
2. card image is the primary visual identifier
3. dateCreated, defaulting to today
4. 5. card size, with common presets plus custom dimensions such as 5.5" × 5.5"
6. tags handle occasion/style/technique rather than separate fields
7. paperPackIds array
8. colorIds array
9. favorites
10. Card Library grid, similar to paper pack grid
11. Card Detail opens in the right-side panel, like Paper Detail
12. Add Card uses a top button, similar to add color and add paper
13. When adding card image, tags and paper pack info, it should show up in the right panel, like paper detail.
14. paper-pack selection should ultimately come from the real catalog
15. stampSets is an optional array because a Card may use multiple stamp sets
16. Card images use a separately selected Card image-library folder. Images already inside it are referenced without copying; images selected elsewhere are copied into its root. The app creates a sibling thumbnail and keeps legacy Card image paths readable from the Paper image folder
17. Add Card and Edit Card reuse the same form; replacing an image does not automatically delete the previously referenced image file
cards and paper packs should eventually link in both directions
card images should use the same folder-backed + thumbnail methodology you’ve now established for paper images

# Decision 30
## Global Tag Vocabulary with Categories

CSC will use a single global tag vocabulary shared across Paper Packs, Cards, and Stamp Sets rather than maintaining separate tag vocabularies for each product type.

Each tag will indicate which product types it applies to: Paper, Card, Stamp, or any combination of them.

The tag system will also support **categories** for organizing related tags. Categories provide organization and broader filtering but are not themselves assigned to catalog items.

A tag may:
* Apply to one or more product types.
* Belong to no category, one category, or multiple categories.

For example, `Birthday` may belong to both `Messages` and `Celebrations` while remaining a single global tag.

Category relationships will be limited to **one generation**. Categories cannot be nested within other categories, and a tag that belongs to a category cannot itself become a category for additional tags.

Items will store only their assigned tag IDs. Category membership will be derived from the global tag vocabulary rather than stored on individual Paper Packs, Cards, or Stamp Sets.

### Rationale

Separate Paper and Card tag vocabularies create duplicate concepts and allow equivalent tags to develop different meanings across product types. Adding Stamp Sets would increase this problem.

### A global vocabulary:

* Provides consistent terminology across CSC.
* Prevents unnecessary duplication such as separate Paper, Card, and Stamp versions of `Holiday`.
* Allows the same tag to be reused wherever appropriate.
* Makes a growing tag inventory easier to manage.
* Supports broader concepts such as `Messages`, `Celebrations`, and `Animals` without requiring deeply nested tags.
* Allows one tag to participate in multiple useful classifications.

This architecture also supports the planned Stamp Library workflow, where a Stamp Set can be found through multiple descriptive tags without requiring individual records for every stamp in the set.

### Migration Principle: Migration principle: preserve first, organize afterward

Existing Paper and Card tag assignments must be preserved during migration.

Existing vocabularies will first be consolidated into the global vocabulary without automatically imposing category relationships.

Exact duplicates may be consolidated safely. Potential near-duplicates, such as singular/plural variants or possible misspellings, should be surfaced for user review rather than automatically merged.

Category organization will occur after the existing vocabulary has been safely migrated.

# Decision 31
## Global Tag Catalog Model, Migration Identity, and Filtering Semantics

This decision refines and supersedes the architectural details of the earlier Global Tag Vocabulary decision while retaining its purpose.

CSC will use one versioned global catalog containing separate tag and category entities. Tags have stable immutable IDs, a display name, applicability to one or more of Paper, Card, and Stamp, and zero or more category IDs. Categories have stable IDs and display names. Categories are never assigned to catalog items, do not declare product applicability, cannot contain or belong to other categories, and derive their relevance from member tags. Catalog items store only tag IDs.

Legacy name-based Paper and Card tags receive deterministic hash-derived IDs in the form `tag-<stable-hash-of-normalized-name>`. The composite hash is derived solely from the normalized name and contains no slug or processing-order component. Exact normalized names consolidate into one tag and union their product applicability. Different normalized names remain separate. A pre-existing computed-ID collision receives a deterministic name-derived fallback. Near-duplicates are reported for review but are not automatically merged. Renaming a migrated tag never changes its ID; tags created after migration may use generated opaque IDs. Migration preserves all assignments after applying previously approved legacy normalization and initially creates no category relationships. The retired Paper keyword `Background` continues to normalize to an empty value and is not recreated as a global tag or reassigned to `Scenery`.

Selected filters retain AND behavior. A selected category is one filter whose members are evaluated with OR behavior. Narrowing that category to selected member tags refines the category filter rather than creating unrelated additional filters. For example, Animals plus Floral means `(Land Animals OR Water Animals OR Flying Animals) AND Floral`; narrowing Animals to Flying Animals means `Flying Animals AND Floral`.

Deleting a category removes only its relationships and never deletes member tags. A tag with item assignments cannot be converted into a category without explicit resolution of those assignments.

During the persistence transition, inline legacy-name tag creation remains supported only as a compatibility bridge for the existing UI. This bridge must be removed when the global tag-selection UI replaces the legacy pickers; it is not a second permanent tag source of truth.

### Proposed Import Conflict Policy — Pending Separate Approval

These rules are documented for review and are not implemented by Phase A:

- For a new-format import with the same stable tag ID but different names, the ID establishes identity. Keep the local name by default, remap imported assignments to that ID, and union applicability and valid category relationships. An explicit conflict choice may instead adopt the imported name after normalized-name validation.
- For different stable IDs with the same normalized name, keep the local ID and display name, remap imported references to the local ID, and union applicability and valid category relationships. An empty local catalog retains the imported ID.
- For a legacy name-only backup imported into a migrated catalog, resolve an exact normalized current name first. If none exists, create a new uncategorized tag with applicability derived from the legacy Paper/Card context. Fuzzy matches require review and never merge automatically.
- A deterministic legacy ID that happens to match a renamed local tag does not prove identity because the legacy backup contains no ID. If no current exact-name match exists, require explicit resolution between the renamed local tag and a separate newly created tag.
- For a new-format backup containing a tag renamed on another installation, the shared stable ID establishes identity. Retain the local name by default and report the divergent imported name; backup time alone does not decide which rename wins.
- All reconciliation and ID remapping must finish before validation and the atomic restore transaction. Unresolved conflicts result in no writes.

# Permission Notes
## The File System Access API requires:
secure context, generally HTTPS or localhost
explicit user action to open folder picker
user-selected folder access
possible re-permission later
MDN notes that directory picker calls require user interaction and can throw security/permission errors if blocked or denied. Chrome documentation also notes that powerful file APIs require user permission and feature detection. Sources: MDN showDirectoryPicker(), Chrome File System Access docs.
