# Card Supply Catalog

## User Experience & Design Guide

This document defines the visual and interaction principles for Card Supply Catalog. Functional behavior is defined in SPEC.md, and implementation details are defined in ARCHITECTURE.md.

**Version:** 1.0  
**Status:** Frozen

**Last Updated:** 2026-07-01

# Design Priorities

1. Recognition over recall
2. Paper before interface
3. Simplicity before features
4. Speed before decoration
5. Consistency before cleverness

# Philosophy: The interface should disappear behind the paper. The UI exists to showcase the DSP—not compete with it.

# Things We Don't Do:
No skeuomorphic craft graphics.
No textured backgrounds.
No decorative borders.
No unnecessary gradients.
No animations that distract from browsing.

# CSS Philosophy
Use semantic class names.
Favor CSS Grid for layout.
Use Flexbox for component alignment.
Prefer CSS variables for colors and spacing.
Minimize media queries through fluid layouts.
Avoid fixed widths whenever possible.

# Overall Experience
Card Supply Catalog should feel calm, uncluttered, and inviting. The interface should encourage browsing and rediscovery rather than data management. Users should spend their time looking at paper, not interacting with the application.

# Visual Hierarchy
Highest Priority: DSP images
Secondary: DSP name
Tertiary: Availability
Year
Keywords
Lowest Priority:
Buttons
Controls
Settings

# Empty States
Empty Library
Friendly welcome message.
Prominent + Add DSP button.
No giant illustration.
No unnecessary decoration.
Missing Images - Show tasteful placeholders. 
Never make the user feel like something is "broken."

# Feedback
How the app talks to the user: 
Save successful
DSP added
Images imported

Messages should be: 
short
positive
informative

# Motion
buttons highlight
dialogs fade in
image viewer opens smoothly

No bouncing, spinning or animated cards

# Icons
Icons should clarify actions, never replace labels. Not mysterious icon-only buttons.

Examples:
✓ Settings
✓ Search
✓ Add

# Responsive Priorities
Primary: Laptop, iPad Landscape
Secondary: Desktop
Tertiary: Phone

Desktop and laptop experiences are optimized first. Tablet is a first-class supported experience. Phone support is functional but not the primary design target.

# Forms
Labels above fields.
Consistent spacing.
Related fields grouped together.
Required fields minimized.
Defaults provided whenever possible.

# Error Philosophy
Make mistakes easy to recover from.
For example: 
Replace image
Undo delete (future)
Skip images
Edit metadata later

# Performance Goals
The application should feel instantaneous.

Target:
Startup < 1 second
Search updates immediately
Library scrolling remains smooth with hundreds of DSP packs

# Accessibility
Good color contrast
Keyboard navigation
Visible focus indicators
Descriptive labels
Images don't rely on color alone

# Consistency Rules
Primary action always on the right.
Cancel always on the left.
Dialogs behave consistently.
Similar actions use the same wording throughout the app.

# Image Quality
Images are the application's primary content.

The interface should maximize the size and clarity of paper thumbnails while maintaining a clean, consistent layout.

Whenever possible, images should be large enough for users to recognize patterns without opening the detail view.

# Delight
The app should have moments to delight the user. 
For example: When you add a new DSP, it immediately appears under Recently Added with its four thumbnails.

When in doubt, remove something instead of adding something.

# The Ultimate Test
Before adding any feature or visual element, ask:

Does this help the user find paper, or is it just adding interface?