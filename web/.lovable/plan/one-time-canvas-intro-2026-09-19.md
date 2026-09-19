# One-time canvas intro

- Run the sequence only on the first main-canvas mount, not on timeline changes or the commit drawer preview.
- Stagger table entry with GPU-friendly opacity and transform animation.
- Draw relationship edges after the last table settles, then restore their normal diff behavior.
- Respect reduced-motion preferences and verify the initial sequence and later snapshot changes.
