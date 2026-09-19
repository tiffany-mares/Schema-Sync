# SchemaSync Commit Drawer

## Build
- Make the existing “+ Commit” control open a wide drawer from the right, layered over the schema canvas.
- Split the drawer into a CodeMirror 6 SQL editor and a live compact ER preview, with commit message and actions fixed at the bottom.
- Prefill the editor by serializing the currently selected schema into `CREATE TABLE` statements.

## Live preview
- Add a small browser-safe parser for `CREATE TABLE` statements, columns, primary keys, not-null markers, and inline references.
- Debounce parsing by 300ms and update the mini ER diagram as valid table definitions change.
- Show parse status and preserve the last usable preview if the SQL is temporarily incomplete.

## Commit flow
- On commit, create a new local commit from the parsed schema, append it to the sidebar and timeline, select it, close the drawer, and let the existing canvas animate to the new snapshot.
- Animate the new sidebar commit into place and disable submission until the message and a valid parsed schema are present.

## Validation
- Confirm the drawer opens and closes, editor changes update the mini preview, and committing updates the sidebar, timeline, and main canvas without errors.
