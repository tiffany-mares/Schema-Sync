# SchemaSync Hackathon Demo

## Goal
Build a single-screen, projector-ready SchemaSync workspace that visualizes branch schema changes and plays a scripted multi-agent database review. Everything uses local mock data behind replaceable service and hook boundaries; no backend or persistence is added.

## Experience
- Replace the placeholder home screen with a full-viewport dark application shell: top repository controls, branch/commit rail, central ER canvas, review board, and commit scrubber.
- Create a deep charcoal design system with semantic glass surfaces, dotted canvas, distinct GitHub diff colors, separate agent colors, glow effects, and Inter plus JetBrains Mono typography.
- Keep the layout fixed to the viewport with internal scrolling where needed, and adapt narrower screens without introducing page scrolling.

## ER diagram
- Add `@xyflow/react` and `dagre`, with custom animated table nodes and foreign-key edges.
- Auto-layout users, products, orders, and transactions, including PK/FK/NN badges and column-level diff treatments.
- Animate added, renamed, modified, and dropped schema elements; dim unchanged content; draw new relationships with a traveling highlight.
- Include minimap, legend, canvas controls, table hover emphasis, and message-driven focus/pan to referenced tables and columns.
- Connect the bottom commit scrubber to snapshot transitions so nodes enter, exit, and update smoothly.

## Review board
- Build the staged Analyze-to-Release pipeline with completed, active, and pending states.
- Render each scripted agent message in its appropriate format: plan/finding, references, SQL proposal, special before/after revision, dry-run result, verdict, and release receipts.
- Add realistic playback delays, a two-second dry-run state, typing indicators, Play Review, and Shift+R reset.
- Show the sticky approval recommendation after the verdict. Approval triggers a restrained particle burst and replaces the recommendation with release receipts.

## Data boundaries
- Define all requested schema, diff, review, and merge-request types in `src/types.ts`.
- Put mock branches, commits, snapshots, diff data, and merge-request actions behind asynchronous functions in `src/services/api.ts`, preserving `VITE_API_URL` for a future API.
- Implement `useReviewFeed(mrId)` as the scripted source now, while preserving a clean seam for a future `VITE_WS_URL` WebSocket feed.
- Ensure interface code consumes only the service and hook, never mock constants directly.

## Structure and polish
- Split the interface into focused components for navigation, canvas nodes/edges, review messages, pipeline, approval, and timeline.
- Use shadcn buttons/selectors and Lucide icons, Framer Motion for animation, and honor `prefers-reduced-motion` throughout.
- Add unique SchemaSync page metadata and load the requested web fonts correctly through the document head.

## Validation
- Verify dependency/type integration and preview build health.
- Exercise playback, reset, approval, timeline dragging, and message-to-canvas highlighting in the browser.
- Inspect desktop projector and narrower viewport screenshots for readability, clipping, overlap, and motion-safe behavior.
