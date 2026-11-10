# Product

Klice Start is a Personal Browser Dashboard: a calm, beautiful, controlled beginning to every browser session. Not a speed dial, not a bookmark manager. Judged on beauty, orientation, ownership, continuity.

Current state: single-device, local-first MV3 extension with no accounts, sync, billing, or AI. Dashboard data stays on-device. Pexels wallpapers use a public Cloudflare Worker + D1 proxy: only the search query and page go to the proxy; image bytes are fetched directly from Pexels. Anything below describing sync/AI/multi-device is a directional bet, not shipped reality.

## Mission & values

- Mission: calm, beautiful, controlled start to every session.
- User control is non-negotiable. Never monetize attention, data, or confusion: no ads, sponsored tiles, dark patterns, data resale. No mandatory accounts for local value.
- Performance is respect. Latency on a high-frequency surface is a product defect.
- Taste is staffed, scheduled, reviewed. No "ship ugly, fix later."
- Long frame wins unless the short-term cost is existential.

## Decision ranks

Privacy > convenience. Performance > flourish. Control > automation. Simplicity > flexibility. Consistency > novelty. Clarity > cleverness. Trust > conversion. Quality > volume.

A feature failing performance or privacy is rejected regardless of other gains. Refusal triggers: mandatory account for local value, noise, attention competition.

## Core (shipped — all required)

- **C1 Beautiful dashboard.** First screen useful and beautiful by default; understood without instruction.
- **C2 Real-screenshot cards.** Sites recognizable at a glance; captures stay reliable (`captureVisibleTab`, 1200 ms settle, 10 s cooldown).
- **C3 Visual nested folders.** Create, navigate, understand nested groups without lost content.
- **C4 Fluid direct manipulation.** Drag, drop, reorder, grouping immediate, predictable, stable. One undo entry per gesture.
- **C5 Low-friction save.** Popup + `Alt+Shift+D`; obvious, fast, recoverable, seconds.
- **C6 Search saved resources.** Title/URL retrieval without browsing (`search-index.ts`).
- **C7 Import favorites.** Chromium/Firefox/Vivaldi bookmark HTML in first session; screenshots fill in over visits.
- **C8 Personal customization.** Bundled/gradient/solid/custom wallpapers, glass intensity, clock/greeting/search/tiles. Personal without degrading the default.

## Important (NOT shipped — paid/retention unlocks)

- **I1 Cross-device sync.** Same space on every device. Strongest paid trigger.
- **I2 Cloud backup.** Recovery and peace of mind. Paid retention.
- **I3 Bento widgets.** Restrained info blocks. Today: clock + greeting only.
- **I4 AI organization.** Suggestions users accept because accurate, understandable, reversible — dismiss/undo everything.
- **I5 Semantic search.** Retrieval by meaning, not title/URL.

## Anti-requirements (as binding as Core)

No feeds, ads/sponsored tiles, mandatory accounts, dark patterns, browser lock-in, unconsented AI, new-tab slowdowns, config-heavy onboarding. Default must be excellent before any flow exists.

## Quality bar (definition of done — fail any item, not done)

Empty/loading/error states that guide and recover. Every mouse action keyboard-reachable. Accessible names, semantics, contrast. Responsive. One easing/timing logic. Consistent type/hierarchy. Immediate + acknowledged actions. `prefers-reduced-motion` respected. Visible focus.

## Feel & motion

- Feels like coming home: calm, personal, fast, controlled, quietly premium. Evaluate at the 1000th open, not the 1st.
- Acknowledges instantly. No tours delaying value, no premature popups, no decorative motion, no dense first-run settings, no self-promotion interrupts.
- Motion rule: if removing it loses no understanding, cut it. Design for the 1000th time.
- Premium = visible intention. Content > controls > configuration. Choose what not to show. Edge cases first-class: empty folder, failed screenshot, invalid drop.
- Craft = rhythm/spacing/type that recede; a missing microinteraction reads as doubt.

## AI canon (binding when AI ships)

Proposes; user disposes. Optional with a non-AI path. Transparent and undoable. Space never changes shape without consent. Never blocks core workflows. Must pass the remove-AI test. AI strengthens Klice Start and never becomes Klice Start.

## Brand & tone (binding on first public surface)

Calm, precise, tasteful, protective. Never inflated, frantic, or clever at the user's expense. Clear before expressive. Confident without exaggeration. Warm without cute (no infantilizing). Premium without elitist. Honest about limitations. Plain language, benefit over mechanism, no hype ("supercharge" never ships). Illustrations are rare — default is none; a background must earn its place against readability; icons recede once learned. Recognition = a composed screen with real cards, folders, spacing — not a logo.

Brought forward from `deferred/06-brand-strategy.md`: personality + voice table + writing rules + illustration philosophy. Left behind: marketing/community/changelog playbooks (no public surface yet).

## Vocabulary (never say → say)

Speed dial / bookmark manager / tile / shortcut / tab / collection / group / theme / layout / configuration → Card, Folder (+ Nested), Dashboard, Setup, Browser Home. Sync ≠ Backup (continuity vs recovery). Premium = quality, not price. Calm ≠ minimalism. Ownership ≠ customization. AI = Assistant Layer, never the product; a suggestion never acts silently.

## North Star (directional)

Weekly Habit Users (meaningful action 4+ days/week). Analytics privacy-preserving and aggregated — never link contents, history, or identity. Roadmap order: identity → free delight → continuity → intelligence → network. Monetization and growth hypotheses unvalidated.
