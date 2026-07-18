<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Keeping project docs current

`docs/PROJECT-SCOPE.md` is the source of truth for what the project includes and excludes.
`docs/PROJECT-HISTORY.md` tracks progress against it: the phases built, plus a to-do list of
in-scope work not yet done. Keep them in sync, with scope leading:

- When a feature ships: add its phase to the history and remove the matching to-do item.
- When the scope changes (a capability added, removed, or moved to a non-goal): edit
  `PROJECT-SCOPE.md` first, then bring the history to-do list in line with it.
