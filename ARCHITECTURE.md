# Card Supply Catalog

## Architecture Guide
Version: 1.0

Status: Frozen

Last Updated: 2026-07-01

1. Architectural Goals

# Principles.

Simple over clever.
Local-first.
Offline-first.
Human-readable data.
Modular JavaScript.
Minimal dependencies.
Easy to maintain.
Easy to back up.

# Technology Stack
HTML5
CSS3
Modern JavaScript (ES Modules)
Local JSON storage
Local image files
Git

No frameworks.
No npm dependencies.
No build tools (Version 1).
This is an intentional design decision.

# Project Structure
card-supply-catalog/

README.md
SPEC.md
DESIGN.md
ARCHITECTURE.md
ROADMAP.md
DECISIONS.md
CHANGELOG.md

index.html

css/
js/
assets/
data/

# JavaScript Modules
Every module should have one job.
For example:

Module	    Responsibility
app.js	    Application startup
library.js	Library screen
detail.js	DSP detail screen
add-dsp.js	Add/Edit workflow
images.js	Image handling
search.js	Search and filtering
settings.js	Settings
storage.js	Read/write catalog
backup.js	Automatic backups
ui.js	    Shared UI helpers

# Data Storage
The application stores:

catalog.json
Images/
Backups/

# JSON Design
Each DSP contains:

unique ID
name
owner
release year
pattern count
availability
refill available
keywords
patterns

Readable JSON.

Pretty printed.

Human-readable and manually recoverable if necessary.

# Images
Images may come from:

Official product images
Internet searches
Personal photographs

Images are:
optional
replaceable
individually managed
imported by folder or by file

# Backups

Very simple.
Automatic.
Created whenever the catalog changes.
Rolling history.
No user intervention required.
Backups should never interrupt normal application use.

# Error Handling
Never lose user data.
Validate before saving.
Recover gracefully.
Never corrupt catalog.json.

# Performance Goals
Startup feels instantaneous.
Search updates immediately.
Library scrolling remains smooth.
Thumbnail generation happens in the background.

# Coding Standards
One responsibility per module.
Semantic function names.
No duplicated logic.
Favor readability.
Small functions.
Self-documenting code.
Consistent formatting.
Functions should generally perform one task and remain small enough to be easily understood without scrolling extensively.

# Module Communication
Modules communicate through well-defined interfaces.
Avoid direct manipulation of another module's internal state.
Shared functionality belongs in ui.js or other dedicated shared modules.

# File Ownership
Each file should have a single clear responsibility.

When a feature grows large enough to require multiple responsibilities,
split it into additional modules rather than expanding existing ones indefinitely.

# Data Evolution
Catalog Compatibility

Future versions should migrate existing catalog data whenever possible.

Changes to the JSON structure should preserve existing user data automatically.

# Git Workflow

Commit frequently.
One logical change per commit.
Meaningful commit messages.
Tag milestones.

# Future Expansion
The architecture should support future additions such as:

Cardstock
Ribbon
Embellishments
Custom keywords

without redesigning the application.

# Architectural Constraints
The application must work completely offline after installation.
The application must not require a cloud service.
User data must remain under the user's control.
Images are never uploaded automatically.
No feature may require an internet connection to use the catalog.

# Architecture Invariants
Never introduce a framework without approval.
Never combine unrelated responsibilities into a single module.
Never sacrifice readability for brevity.
Never store user data in multiple locations.
Never duplicate business logic across modules.
Prefer extending existing modules over creating unnecessary new ones.