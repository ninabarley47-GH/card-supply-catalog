# Card Supply Catalog

## Guidelines to Follow When Contributing to this Project

Version: 1.0

Status: Frozen

Last Updated: 2026-07-01

# Before implementing a feature:

1. Read SPEC.md.

2. Read DESIGN.md.

3. Follow ARCHITECTURE.md.

4. Keep commits focused.

5. Prefer simplicity.

6. Document major decisions.

# Change Safety / Implementation Discipline
For requests that affect data models, persistence, import/export, storage, shared components, navigation architecture, or multiple features/modules, do not immediately implement the request. First provide an impact assessment and proposed implementation plan. Wait for approval before modifying files.

Do not be so cautious that every change produces a giant risk report. But you do have permission to say:
This is possible, but I don't recommend implementing it this way because…
or:
This adds substantial complexity for relatively little benefit. I recommend leaving the current behavior in place.