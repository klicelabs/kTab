# Architecture deep dive (reference — describes what IS)

Read-only survey of `apps/extension` + `packages/ui` as built. Every claim cites a file. Items marked UNCLEAR are ambiguous in the code. No proposals.

## Part 1 — How the extension works today

### 1.1 Entrypoints and boot flow

Newtab open runs, in order (`entrypoints/newtab/main.tsx`):

1. Imports evaluate: React, `App.tsx`, `globals.css`, snapshot modules, `setup-store` — store creation runs here (`src/stores/setup-store.ts:235-240` `preHydratedInitialState()` = `normalizeState(null)` + localStorage first-paint mirror; creation schedules no persist write).
2. `main.tsx:27` `applyWallpaperPrehydrate()` paints frame 1 from the wallpaper mirror (`src/lib/wallpaper-snapshot.ts:127-142`, `#bg-layer…!important`).
3. `main.tsx:38` explicit mirror checkpoint (`void readFirstPaintSnapshot()`).
4. `main.tsx:38-42` `createRoot(#root).render(<StrictMode><App/>)` (`entrypoints/newtab/index.html:9-10`).
5. `main.tsx:44-49` `clearPrehydrateWhenLive` — MutationObserver on `#bg-layer` style + 5 s backstop (`wallpaper-snapshot.ts:162-204`).
6. `App.tsx:316-317` cross-tab sync + persist-error toast; selectors `319-338`; navigation init gated on hydration (`375-391`); orphan-thumbnail sweep (`364-373`).
7. DEV-only: `main.tsx:19-21` dynamic `src/dev/seed` import (dropped from prod builds).

Popup (`entrypoints/popup/`): `main.tsx:8-12` mounts `./App` with `popup/style.css`; `App.tsx:67-85` hydrate gate (renders nothing until the store resolves); `97-176` pending-save load vs active-tab query, then `captureVisibleTab`; `191-246` pending create (`addFolder :219` + `addCard :220` + `flushPersist :227`, rollback `:240`); `248-302` save path (`saveThumbnail :256`, `updateCard history :271` + `flushPersist :272` / `addCard :284` + `flushPersist :291`). Every popup mutation flushes synchronously — no 200 ms coalescing window, unlike newtab.

Background worker (`entrypoints/background.ts`): owns `STORAGE_KEY="perch-setup"` (`:29`); envelope read/write helpers (`:40-51`); save serialization chain (`bookmarkSaveChain/enqueueBookmarkSave :174-179`); `storage.onChanged` debounce 150 ms (`:181-187`) feeding rebuilds (`:284-287`); thumbnail capture (`captureVisible() :193-201`, settle 1200 `:203`, 10 s cooldown, pending/inFlight maps `:203-228`); context-menu items + `add-current-page` command → `captureAndAdd/captureAndOpenPendingSave (:289-310)`; tab `onUpdated/onActivated/onRemoved` → `queueMissingThumbnailCapture (:312-358,561-606)`; `captureAndAddNow (:455-544)` captures, reads back, pushes/updates, `writeSetup (:517,536)`, sets badge; `captureMissingThumbnail (:608-725)` checks permission, settles, triple re-reads, `writeSetup (:696)`; lifecycle `defineBackground (:271-280)` wires onInstalled/onStartup rebuilds.

Area mechanisms (how the big interactions work, not just who): grid remounts per folder (`dial-grid.tsx:731 key={folderId}` inside AnimatePresence + `PAGE_VARIANTS` from `page-motion.ts:47`); DnD previews write live then `restoreItemOrder` on cancel (`dial-grid.tsx:612-613`); folder reset on navigation (`:622`); toolbar overflow measured live (`navigation-toolbar.tsx` lane measuring); settings inert lifecycle arms offscreen then lifts on transition end (`settings-sidebar.tsx:166-222`); menu portal mounts via `createPortal` with `aria-hidden`+`inert` while closed (`context-menu.tsx:501-505`, unmounted entirely when closed per P2); tray bulk ops commit one history entry per gesture.

### 1.2 Component inventory (newtab + shared)

Format: responsibility | reads → / writes → / theme branch (HOW). Line refs are selector/branch sites.

### Grid
`newtab/dial-grid.tsx` — virtualized card/folder grid with DnD, marquee selection, undo snapshots.
R: setup (`:120-123,222,604`), selection (`:138-139,150-152,261,325,379,437,451,517,576,663,686`), history (`:231`). W: history.commit (`:231`), selection.toggle/selectRange/clear (`:150-152,244`), setup.restoreItemOrder (`:613`). B: dialLayout only (`:122`; render/class/drag-ghost/data-attr `:126,184,401,418,427,700,718,740,748,754,759,803`) — no material branch.

### Cards
`newtab/dial-card.tsx` — single bookmark card: card+icon modes, inline rename, context menu.
R: appearance (`:59`), image (`:60`), setup (`:61-65`), rename (`:70-72`), move-dialog (`:73`), selection (`:147-149`). W: setup.updateCard (`:99-101`), rename.cancel (`:102`), selection.toggle (`:147-149,292,305`). B: isLiquid+resolvedDark+dialLayout — conditional class (`:120,125-131`), conditional render (`:163`), glass helpers (`:228,268-314`).
`newtab/icon-mode-tile.tsx` — icon-mode label wrapper around IconAppTile.
R: none. W: none. B: `wallpaperText("primary")` class only (`:38`).
`newtab/icon-app-tile.tsx` — favicon/letter tile primitive with CSS-var surface.
R: none. W: none. B: none.

### Folders
`newtab/folders/folder-preview-card.tsx` — folder card with preview stack, rename, context menu.
R: appearance (`:111`), setup (`:112-113,123,222,385`), rename (`:115-117`), move-dialog (`:118`), selection (`:225,388,403`), image (`:649`), history (`:128`). W: history.commit (`:128`), selection.toggle, rename begin/cancel, move-dialog.open. B: isLiquid+resolvedDark+dialLayout — class (`:164-174`), render/drag props (`:142,149-154,180`), glass family (`:209-412`).
`shared/folder-tree-picker.tsx` — recursive folder destination tree for move dialogs; props-only.
R: none. W: none. B: isLiquid prop (`:36,87`) threaded into conditional classes (`:152-235`).

### Toolbar
`newtab/toolbar/navigation-toolbar.tsx` — top bar shell: folder tabs lane, history buttons, actions, overflow measuring.
R: appearance only (`:106,338-339`); folders/actions arrive via props. W: none (emits callbacks). B: isLiquid+resolvedDark — GlassIcon-vs-flat conditional render (`:371-379`), props, class (`:450,565-572`).
`newtab/toolbar/folder-tabs.tsx` — scrollable folder tab strip with rename, DnD, context menus.
R: appearance (`:171`), selection (`:178,196,533,539-540,698,711`), rename (`:503-505`), move-dialog (`:506`), setup (`:509,521,526`), history (`:514`). W: history.commit (`:514`), setup.restoreItemOrder (`:495`), selection.toggle/clear, rename begin/cancel, move-dialog.open. B: isLiquid+resolvedDark (`:171,440-463`) — class, props, glass menu items (`:652-722`).
`newtab/toolbar/folder-tabs-overflow.tsx` — overflow "+N" menu with folder search.
R: appearance (`:59`), rename (`:71,74`), setup (`:341`), history (`:351`). W: history.commit (`:351`), rename.cancel. B: isLiquid+resolvedDark (`:59`) — conditional class throughout (`:210-398`).
`newtab/toolbar/toolbar-actions.tsx` — persistent settings button, glass vs flat.
R: appearance (`:25-26`). W: none. B: isLiquid — conditional render (`:31-73`), `glassLiquidProps (:27)`.
`newtab/toolbar/toolbar-icon-button.tsx` — single toolbar icon button, glass-aware.
R: appearance (`:61-62`). W: none. B: isLiquid+resolvedDark — conditional render (`:78-90`), class (`:101-143`).
`newtab/toolbar/glass-surface.tsx` — THE material container, keyed by GlassTier variant.
R: appearance (`:71-72`). W: none. B: GlassTier (`:7,18,35,75,77`) + isLiquid + resolvedDark — LiquidGlass-vs-flat-div render (`:94-111`), lens optics prop (`:96,103`), `data-glass-role/tone` attrs (`:111,128`).
### Search
`newtab/search/unified-search.tsx` — omnibox: local results + engine search.
R: appearance (`:68`), setup (`:69-76`, 8 selectors incl. cards/folders). W: none (navigates via callback). B: isLiquid+resolvedDark — conditional class (`:413,442-443,529,695,718-719,730,749`).

### Settings shell
`newtab/settings/settings-sidebar.tsx` — settings shell/sidebar with pane nav and inert lifecycle.
R: appearance (`:80-81`), history.pending (`:270`). W: none. B: isLiquid+resolvedDark + `glassLiquidProps (:87)` — conditional render (`:86-99`), class (`:112`).
`newtab/settings/settings-motion-workspace.tsx` — mount/unmount gate for the settings subtree by motion phase.
R: settings-motion (`:17,42,52-54`). W: motion.close (`:67`), finishClose (`:68`). B: phase data-attrs/CSS vars only (`:28,31,45`) — no material branch.

### Settings panes (all write via `updateSettings`/`updateBackground`)
`newtab/settings/panes/appearance-pane.tsx` — material/theme/accent/glass-intensity controls.
R: image (`:79`), setup appearanceMode/glassIntensity/colorScheme/accent/bg (`:167-177`). W: updateSettings (`:176,341`), updateBackground (`:177`). B: appearanceMode — conditional value (`:334,341`), conditional render (`:426`).
`newtab/settings/panes/general-pane.tsx` — layout/tiles/clock/greeting/quick-link toggles.
R: 17 setup selectors (`:74-90`). W: updateSettings (`:87,109`), updateClock (`:88`), updateGreeting (`:89`), updateQuickLinks (`:90`). B: dialLayout — conditional render (`:113,137`), value prop (`:106`).
`newtab/settings/panes/wallpaper-pane.tsx` — background source + adjustments editor.
R: setup (`:339-341,344`), image (`:347,350,353-354,357`). W: updateBackground (`:340`), commitCustomWallpaper (`:341`), removeCustomWallpaper (`:344`), image save/delete/preview/clear. B: none on material tokens (UNCLEAR — indirect via preview rendering, not fully traced).
`newtab/settings/panes/search-pane.tsx` — search engine/placeholder/width controls.
R: setup search slice (`:60`), updateSearch (`:61`). W: updateSearch. B: none.
`newtab/settings/panes/bookmarks-pane.tsx` — bookmark/folder CRUD table + import/export.
R: appearance (`:207`), setup (`:94,195-206,275,282`). W: add/update/move/deleteCard/Folder (`:199-206`), updateThumbnailCapture (`:95`). B: isLiquid prop-only (`closeGlass :1096,1181,1237`).
`newtab/settings/panes/advanced-pane.tsx` — danger zone: reset/export + debug dialogs.
R: setup (`:38-40,43`), appearance (`:44`). W: resetAll (`:43`; export path UNCLEAR — not traced). B: isLiquid prop-only (`:163`).
`newtab/settings/panes/root-settings-pane.tsx` — root pane composing AppearancePane + nav rows.
R: none (props only). W: none. B: none.

### Settings shared primitives (all props-only, store-blind, no branches)
`settings/shared/setting-row.tsx` (label+control row grid), `select-row.tsx` (labelled select), `slider-row.tsx` (slider row), `segmented-control.tsx` (animated selector), `section-card.tsx` (section container), `settings-label.tsx` (label+tooltip), `settings-feedback.tsx` (inline hint — behavior beyond name UNCLEAR, not read fully), `settings-tooltip.tsx` (delayed tooltip), `settings-expandable.tsx` (collapsible group), `settings-range-slider.tsx` (live slider, flush-on-release), `settings-action.tsx` (in-row button).

### Dialogs
`newtab/history-dialog.tsx` — undo/redo history list dialog.
R: history past (`:25`), future (`:26`). W: requestUndoTo (`:53`), requestRedoTo (`:75`). B: none.
`newtab/quick-link-editor-dialog.tsx` — add/edit quick-link form dialog.
R: none (props + local state). W: none (onSave prop). B: isLiquid prop (`:26,43,73` closeGlass).
`shared/move-to-dialog.tsx` — move selection/cards to folder dialog.
R: move-dialog ids/close (`:65-66`), setup (`:67-70,134,137`), appearance (`:71`), history (`:178,188`), selection (`:192`). W: setup.moveItemsToContainer (`:70`), history.commit (`:178`), requestUndo (`:188`), selection.clear (`:192`), move-dialog.close. B: isLiquid prop (`:204,229`).
`shared/create-folder-from-selection-dialog.tsx` — name-and-confirm dialog for selection→folder.
R: none (props). W: none (onConfirm prop). B: isLiquid prop (`:29,40,78` closeGlass).

### Empty states
`newtab/empty-landing.tsx` — first-run empty hero with add-card CTA.
R: setup (`:51-52`), appearance (`:49-50`). W: setup.addCard (CTA). B: isLiquid+resolvedDark+glassLiquidProps (`:53`) — `ripple=!isLiquid`, conditional class (`:74-80,101-102,120-121,130,204`), conditional render (`:71,108,163`).

### Quick links
`newtab/quick-links.tsx` — icon launch rail with edit menu.
R: appearance (`:24`), setup (`:25-28`). W: updateQuickLink (`:27`, via dialog), removeQuickLink (`:28,100`). B: isLiquid+resolvedDark (`:24`) — conditional class (`:63,75,77,86,96`), prop (`:114`).

### Widgets and shell
`newtab/appearance-provider.tsx` — THE theme funnel (see 2.1).
R: appearanceMode (`:57`), colorScheme (`:58`), accent (`:59`), glassIntensity (`:60`). W: none (provides context). B: defines it — CSS vars/effects (`:103,110,115,126`), context props (`:157,160,168`).
`newtab/background-layer.tsx` — wallpaper/gradient/pexels backdrop renderer.
R: 10 setup selectors (type/imageId/wallpaperId/gradientId/color/pexels*/blur/brightness/opacity `:47-63`), image (`:59,65`). W: none. B: none on material tokens.
`newtab/clock-widget.tsx` — hero clock/date/greeting display.
R: setup via `use-clock` (`:17-19`). W: none. B: wallpaperText classes only (`:34,45,58`).
`newtab/rest-mode.tsx` — fullscreen rest overlay with clock + exit CTA.
R: none (useClock hook + props). W: none. B: wallpaperText only (`:25,32,39,43,51,56`).
`newtab/selection-tray.tsx` — bulk-action bar for multi-select.
R: selection (`:81-84,556`), setup (`:85-90,200,243`), move-dialog (`:93`), appearance (`:94`), history (`:220,229,265`). W: history.commit (`:220,265`), requestUndo (`:229`), setup.moveItems/createFolder, selection.clear/removeAll, move-dialog.open. B: isLiquid+resolvedDark (`:94,655-656,682,688`) — conditional class (`:364-567`), prop (`:493,645`).
`newtab/history-manager.tsx` — toasts and pending-confirm for the undo system.
R: history (`:53-55,62,83,195`), rename (`:176-177`). W: requestUndo (`:71`), cancelPending (`:109,153`), confirmPending (`:114`), consumeDeadIdNotice (`:129`), rename.cancel (`:176`). B: none.
`newtab/page-context-menu.tsx` — page-level context menu (background/pexels/history actions).
R: appearance (`:43`), setup (`:44-45,48,51,71`), image (`:52`), history (`:114`). W: setup.updateBackground (via `:51`). B: isLiquid+resolvedDark (`:43`) — conditional class (`:111,130,153,163,190`).
`newtab/go-to-top.tsx` — scroll-to-top FAB, hidden while tray open.
R: selection (`:67`). W: none. B: none.

### Other shared
`shared/inline-rename-input.tsx` — uncontrolled inline rename text field.
R: none. W: none (onCommit/onCancel props). B: none (imports glassShape only).
`shared/svg-icon.tsx` — raw SVG-XML renderer.
R: none. W: none. B: none.

### 1.3 State architecture (7 Zustand stores)

`setup` (`setup-store.ts:43-189`) — folders/cards/activeFolderId/settings/itemOrder + ~30 actions.
Persisted: YES — `perch-setup`, partialize 5 keys (`:1236-1244`). Writers: App (33 refs), settings panes (bookmarks/general), popup (`addCard/updateCard`), `services/bookmarks-html.ts` (`setState :192-196,221-226`, replace via backup). Readers: App, `background-layer.tsx` (14 selectors), bookmarks/general panes, `unified-search.tsx` (9 selectors), `use-clock.ts` (8 selectors). Boundary: sole owner of domain data; history commits ride on its mutating actions.

`history` (`history-store.ts:48-61`) — past/future/pending/notice/notices/noticeSeq/deadIdNotice.
Persisted: NO (`:107` plain create). Writers: setup mutating actions (deleteFolder/deleteCard/updateCard `:548,849,622`), `dial-grid.tsx:231`, `move-to-dialog.tsx:178`, App combine/tab-drop (`:709-716,818-843`). Readers: history-manager (`:13`) /dialog (`:5`), selection-tray (`:4`), move-to-dialog (`:3`), App (6 refs), dial-grid (2 refs). Boundary: undo is a separate stack applied back onto setup via snapshots (`:103` applier).

`image` (`image-store.ts:13-36`) — previewBackgroundImage + thumb/bg get/save/delete/clear/sweep (IDB wrappers).
Persisted: NO — IDB only (`:38`). Writers: popup `saveThumbnail (:75,256)`, `services/wallpaper.ts (:309-327)`, wallpaper-pane (6 refs), `history-store.ts:147,281,309` (GC deletes), App sweep (`:366`). Readers: `dial-card.tsx:60` getThumbnail, background-layer (3 refs), folder-preview-card (2 refs), wallpaper-pane, `services/backup.ts:36-58`. Boundary: bytes live in IDB; the store holds no pixels.

`selection` (`selection-store.ts:38-56`) — items/selectedIds/lastSelectedId/scope + select/toggle/range/clear/selectAll/addAll/removeAll.
Persisted: NO (`:63`). Writers: `dial-grid.tsx:150-152,244,379,663-686`, App (`:463,845,890,1114` addAll/clear), `use-marquee-selection.ts` (5 refs). Readers: dial-grid (16 refs), `dial-card.tsx:147-149,305`, selection-tray (6 refs), folder-tabs (8 refs), App (7 refs). Boundary: ephemeral gesture state; cleared on navigation/drop.

`rename` (`rename-store.ts:10-16`) — editing `{kind,id}|null` + begin/cancel/isEditing.
Persisted: NO (`:23`). Writers: App (`:340-341,399,719,893`) begin/cancel, `dial-card.tsx:71-72`, `history-store.ts:237` cancel in confirmPending. Readers: `dial-card.tsx:70` isEditing, folder-preview-card (4 refs), folder-tabs (4 refs), folder-tabs-overflow (3 refs), history-manager (2 refs). Boundary: single global session; cancel is null-safe.

`move-dialog` (`move-dialog-store.ts:3-8`) — ids `string[]|null` + open/close.
Persisted: NO (explicitly never persisted, `:13-23` comment). Writers: `dial-card.tsx:73` open, folder-preview-card / selection-tray / folder-tabs (2 refs each). Readers: `shared/move-to-dialog.tsx:65-66` ids/close + folders/cards (`:67-70`) for listing. Boundary: openers pass ids in; the dialog reads domain data from setup.

`settings-motion` (`settings-motion-store.ts:9-18`) — phase `closed|open|closing`, pane, action + open/close/finishClose.
Persisted: NO (`:27`; `:21-26` comment: must not re-run Home selectors). Writers: App (`:611,623,629-630,679`) via `settingsMotionStore`, `settings-motion-workspace.tsx` (9 refs). Readers: settings-motion-workspace, App (`:309` `phase==="open"`), settings sidebar/panel surfaces (full reader list UNCLEAR beyond the 7 App + 9 workspace refs swept).

### 1.4 Storage and IO

Envelope (`lib/storage.ts:762-770`): `{state: Setup, __perchResetGeneration: number}`, key `perch-setup` (`setup-store.ts:1236`, `background.ts:29`). Writes coalesce 200 ms (`:1066-1092`, health `unsaved`); `flushPersist (:819-844)` on demand + unload (`:960-971`); `cancelPendingPersist (:849-863)` for reset; `beginReset (:866-871)` bumps the generation barrier (`:619-620`). Own-write echoes registered (`:792`) and consumed (`:672-678`, `use-cross-tab-sync.ts:39`) so `onChanged` never replays our saves. Quota: 10 MiB (`:754`), preflight at 95% (`:756-760`) throwing `QuotaExceededError`; health `ok|unsaved|failed` (`:683,722-741`). Load: corrupt → quarantine (remove + report, `:1013-1025`); stale generation → null (`:1026-1029`); legacy wallpaper migration (`:1032-1043`). `normalizeState (:531-613)` repairs folders/cards/order on every load.

IDB (`lib/idb.ts`): `perch-db` v1 (`:11-12`), stores `thumbnails` + `backgrounds` (`:13-14`), `put(value,key)` (`:57-69`), ids `thumb_<base36>/bg_<base36>` (`:138-140`), `saveThumbnail/saveBackground (:143-154)`, `idbGetAllKeys (:115-125)` feeds the orphan sweep.

Services (`src/services/`): `wallpaper.ts` (Pexels fetch/download/refresh + bg IDB ownership, `getRefreshRequestIdentity :141`), `backup.ts` (JSON backup build/export/import + image budget, `36-58` image reads), `bookmarks-html.ts` (Netscape serialize/parse + browser-tree merge/replace, writes via `setState :192-196,221-226`), `svgl.ts` (icon catalogue fetch + session/local cache — the one non-setup chrome.storage user).
Icons: `packages/ui/src/icons/icon-map.ts` + `Icon` component (name→SVG); `icon-mode-tile.tsx` letter fallback with `softGradientFromString(url)`; card favicons via `faviconUrl(url)` (`lib/url.ts`) with onError fallback to generated URL.
Keyboard: command `add-current-page` (Alt+Shift+D, `wxt.config.ts:32-39`); in-app Ctrl+K focuses search (`App.tsx:1003-1013`, skipped inside editable/history targets); Ctrl+A selects page scope (`:1077-1095`); Escape precedence (rename → dialog → rest-mode → selection); inputs stopPropagation so grid handlers never see keystrokes (`inline-rename-input.tsx:89-96`).
Boot-time mirrors (frame-1 sources): wallpaper CSS shim (`wallpaper-snapshot.ts:127-142`, lifted by `:162-204`) + 9-flag store seed (`first-paint-snapshot.ts`, applied at store creation `setup-store.ts:235-240`, checkpointed `main.tsx:38`); both read-only pre-mount, storage wins on resolve.

Card write (`popup/App.tsx:284-291`): `addCard` → `setup-store.ts:580-604` builds Card + single `set({itemOrder,cards})` → persist `setItem (:1045-1093)` queues → explicit `flushPersist` → `_doWrite (:830)` mirrors + echo + `storage.local.set (:794)`. `updateCard (:606-657)` no-ops if unchanged (`:614`); `{history:true}` commits one patch entry (`:615-653`). `insertCardAt (:678-715)` reorders+reparents in one set. Delete (`deleteCard :794`, `deleteFolder :417` + bulk prune `:489`): single set + tombstoned thumbnails + one history entry with atomic restore captured inside the action. Move (`insertCardAt :678-715`, `moveItemsToContainer :742`, tab-drop via App `:785-848`): reorder + reparent in one set; frozen drag groups survive mid-drag selection clears; one history entry per gesture (`combine :694-722`). Shared shape across all four paths: exactly one store `set` → one coalesced persist write → at most one history entry; gesture handlers never write storage directly.

### 1.5 Build/bundle structure

`wxt.config.ts:5-6` module-react, MV3; manifest `18,26` 1.2.3, gecko id `20-24`, permissions `storage/activeTab/tabs/contextMenus/bookmarks (:29)`, host + optional `<all_urls> (:30-31)`, command `add-current-page` Alt+Shift+D (`:32-39`); zip sourcesRoot `42-53`; vite dedupe react (`:54-62`). Scripts (`package.json:8-15`): dev (5555 strictPort `:7-16`), build, zip (+`:firefox` variants), `compile` (tsc). Entrypoints on disk: `background.ts`, `newtab/{index.html,main.tsx,App.tsx}`, `popup/{index.html,main.tsx,App.tsx,style.css}`. No code-splitting in prod: no `React.lazy`, no dynamic `import()` outside DEV seed (`main.tsx:20`, `advanced-pane.tsx:105,123`) — outputs follow WXT convention (chunk filenames UNCLEAR without a build in this survey). `packages/ui` (`@ktab/ui`): `globals.css`, `lib/*`, `components/*` (~30 incl. `motion/`, glass/sidebar/dialog/sonner/slider), `hooks/` empty, `icons/*`, `postcss.config`.

## Part 2 — Extension-point analysis

### 2.1 Theme/material extension point

Definitions: `src/types.ts:100` `AppearanceMode="liquid"|"classic"`, `:103` `MaterialMode="glass"|"flat"`, `:114` ColorScheme, `:117` AccentColor. Role map `src/lib/glass.ts:37` `GlassTier=hero|toolbar|surface|nested|search|menu|tooltip` → `GLASS_TIER_VARIANTS (:46)`: hero/toolbar→liquid-refract, surface→liquid, nested→subtle, search/menu/tooltip→liquid-menu. Recipe fns: `glassLiquidProps (:185)`, `glassMaterial (:230)`, `glassLensVeil (:80)`, `glassIntensityParams (:164)`, `glassCssVariables (:200)`, card/menu/footer/focus/drop/tooltip/text helpers (`:270-549`). UI-side: `packages/ui/src/lib/glass-variants.ts:31` `FrostGlassVariant=clear|frosted|subtle|liquid|liquid-menu|liquid-refract`, `:40` density, `:100` `glassVariantStyles`; `surface.ts:24` `FlatElevation=control|controlPressed|floating|menu|panel|dialog`, `:89` `flatSurface(...)`.

Single funnel: `appearance-provider.tsx:57` reads 4 settings → `:92 resolvedDark`, `:95 material`, `:101` toggles `documentElement.classList dark/light`, `:116` writes `--ktab-accent*`, `:134 dataset.ktabMaterial/dataset.ktabContrast`, `:142 --ktab-glass-intensity` + `glassCssVariables()` (blur/saturation/brightness clear+dense), `:153` context `{mode,material,isLiquid,…,prefersContrastMore}` + glass params.

Branching files (HOW) — render switches: `glass-surface.tsx:71,94,124` (LiquidGlass-vs-flat-div — the central switch); `navigation-toolbar.tsx:106,371-379` (GlassIcon-vs-flat); `toolbar-actions.tsx:25-27`; `toolbar-icon-button.tsx:61,79`; `settings-sidebar.tsx:80,87`.
Branching files (HOW) — conditional classes: `dial-card.tsx:59,125,228,268`; `folder-preview-card.tsx:111,169,299,352`; `folder-tabs.tsx:171,440-463`; `folder-tabs-overflow.tsx:59`; `unified-search.tsx:68`; `empty-landing.tsx:49,53,71` (`ripple=!isLiquid`); `quick-links.tsx:24,63,75`; `selection-tray.tsx:94,364`; `page-context-menu.tsx:43,111`.
Branching files (HOW) — values and props: `appearance-pane.tsx:167-168,334,341,426` (conditional values + render); `bookmarks-pane.tsx:207` + `advanced-pane.tsx:44` (`closeGlass` props only).
Prop-drilled, never hooked: `folder-tree-picker.tsx:36,87`; `move-to-dialog.tsx:71`; `create-folder-from-selection-dialog.tsx:29`; `quick-link-editor-dialog.tsx:26`.
Non-branching: `dial-grid.tsx`, `background-layer.tsx`, `clock-widget.tsx`, `go-to-top.tsx`, `history-dialog/manager.tsx`, all `settings/shared/*` primitives, `inline-rename-input.tsx`.

Third theme ("frosted") would touch: `types.ts:100,103` (+ unions), `glass.ts:46` map + any of ~15 recipe fns whose output is tier-specific, `appearance-provider.tsx:95,134` (material derivation + dataset), `glass-surface.tsx:94` (the render switch), `glass-variants.ts:31,100` (+ styles), `surface.ts` if flat gains a sibling, `tokens.css:1143` (flat selectors gate on material), `storage.ts:124` normalizer, plus per-component `isLiquid` ternaries that assume two outcomes (~20 files above — each must decide what frosted means). Roughly 25 files.

Per-theme decisions: backdrop, blur, saturation, brightness, refraction, bezel, veil density, border/hairline, shadow/elevation. Shared: spacing, typography, layout, motion values, iconography.

Behavior coupling: none found between material and timings — `reduceMotion` (motion `useReducedMotion` in dial-grid, go-to-top, selection-tray, unified-search, appearance-pane, settings-sidebar; `tokens.css:855,997,1298,1437`; `page-motion.ts:24,37,41`) is orthogonal to `isLiquid`. One theme-adjacent behavior: `glass-surface.tsx:75` contrast upgrade (`surface→menu` under prefers-contrast). Invariant comment `glass.ts:122`: never animate blur, transform/opacity only.

CSS path (end-to-end): `appearanceMode="liquid"` (persisted, `constants.ts:303`) → provider `:95 material`, `:157 isLiquid` → `:134 dataset.ktabMaterial` + `:142 intensity var` + `:146 blur/saturation/brightness vars` → `GlassSurface:96 optics=glassLiquidProps(glassParams)` → `<LiquidGlass blur/refraction/saturation/brightness/bezel>` + `lensVeil bg-[color-mix(…var(--ktab-glass-intensity)…)]` + `glassVariantStyles[variant]` (`backdrop-blur-[var(--ktab-glass-blur-clear)]`, `glass-variants.ts:68`) → paint. Flat path: same flag → `flatSurface("floating")` → face/shadow classes. Static tokens: `tokens.css:14 --ktab-accent*`, `:20 --ktab-glass-intensity:0.6`, `:31/73` glass foregrounds (light/dark), `:110 --tile-w/--grid-gap`.

### 2.2 Layout/positioning extension point

Computation: `constants.ts:144` tile sizes (132×146 / 160×176 / 196×216), `:162` aspect ratios, `:169` footer 30px, `:171-174` gap 22 / padding 24 / columns 4–10 (default 7, `:286`); icon variant `icon-layout.ts:4` (88×106 / 104×124 / 128×150) + `:45,49,54` config/width/clamp. Width math: `setup-store.ts:1250` `cols*W+(cols-1)*gap+2*pad`, clamped (`:1255`, `icon-layout.ts:54`, `utils.ts:44`, `storage.ts:223`). Render `dial-grid.tsx:120,125` (mode→width fn), `:156 getOrderedRefs`, `:181-185` aspect var, `:725 maxWidth`, `:745 auto-fill` columns (`--tile-w` 148px fallback / `--icon-cell-w` 104px), `:751` gaps, `:759` icon vars; CSS defaults `tokens.css:110` (`--tile-w:160px`, `--grid-gap:22px`), size overrides `:610,614`, cell box `:829`.

Authority: `types.ts:174` `Setup.itemOrder` ("source of truth", legacy `order` reindexed).
Toolkit (`item-order.ts`): `ROOT_CONTAINER` (`:25`); `containerKeyOf` (`:27`); map shape (`:46`); `buildItemOrder` folders-first (`:53`); `repairItemOrder` (`:100`); `getOrderedRefs` (`:179`); `reindexOrders` (`:211`); `reorderGroupKeys` (`:270`); `insertCardsBlock` (`:294`).
Mutators (all in `setup-store.ts`, all rebuild map + reindex): `addFolder :247`; `createFolderFromSelection :266`; `moveFolder :360`; `moveFolders :384`; `deleteFolder :417` (+ bulk prune `:489`); `reorderFolders :552`; `addCard :580`; `moveCard :659`; `moveCards :717`; `moveItemsToContainer :742`; `deleteCard :794`; `reorderCardsInActiveFolder :856`; `reorderItems :875`; `reorderGroup :923`; `insertCardsAt :945`; `restoreItemOrder :911` (DnD snapshot restore, called `dial-grid.tsx:612`); live-preview writes `:562,664,691,723,760,799,859`.
Undo applies container snapshots (`history-store.ts:103` applier).

Ordered-not-positioned proof: `types.ts:3` Folder `{id,name,order,parentId?}`, `:10` Card `{id,folderId,…,thumbId,order,…}` — no x/y/row/col fields; position derives from array order within a container.

Drag-to-reposition impact: supported already — DnD plumbing (`use-grid-dnd.ts`, marquee selection, drag-ghost, drop targets, `restoreItemOrder`), container model, single-set mutations, undo snapshots. Fighting it — the array-order core (`item-order.ts`, all setup mutators assume sequence position), CSS-grid render (`dial-grid.tsx:745` auto-fill flow), `getOrderedRefs` consumers, persisted `order` reindex, preview-slot math (`dial-grid.tsx:834`, `icon-layout.ts:71` 3×3 stack), responsive auto-fill logic.

Navigation vs grid: `setActiveFolder (:578)` flips `activeFolderId (:172)`; grid takes `folderId` prop (`dial-grid.tsx:46`), resolves refs (`:157`), remounts per folder (`:731 key={folderId}` + `PAGE_VARIANTS`), resets DnD (`:622`); tray/move-dialog/empty-landing scope to it; unknown ids fall back to `folders[0]` (`storage.ts:555`); external sync keeps-current-if-valid (`merge-external-setup.ts:20`).

Responsive: no JS resize listeners found; fluid auto-fill inside capped maxWidth; CSS only — `tokens.css:882` (≤900px gap 16), `:892` (≤480px gap 12/tile 132), `:904` search, `:1192` hero ≤640px, `:702` hover/pointer-fine. JS-side: only column clamps. (UNCLEAR: any viewport reads outside swept files — none found.)

### 2.3 Configuration extension point

Full shape (`types.ts:138 Settings`, defaults `constants.ts:284 DEFAULT_SETTINGS`). Every field with its default:
Layout/tiles: `tileSize` small|medium|large (medium); `maxColumns` number (7); `cardAspect` square|horizontal|vertical (vertical); `dialLayout` card|icon (card); `iconShowLabel` bool (true); `showTitle` bool (true); `showDeleteButton` bool, deprecated (true); `openInNewTab` bool (false); `defaultTitleSource` saved|site (saved).
Capture: `thumbnailCapture.enabled` bool (true); `thumbnailCapture.delayMs` number (1200).
Background: `type` wallpaper (of solid|gradient|image|pexels|wallpaper); `color` string; `gradientId` null; `imageId` null; `wallpaperId` tokyo-skyline; `customWallpaper` slot|null; `blur` 0; `brightness` 100; `opacity` 100; `pexelsQuery` "curated wallpaper"; `pexelsFrequency` daily; `pexelsPreviousFrequency` null; `pexelsLastFetched` null; `pexelsLastPeriod` null; `pexelsImageId` null.
Clock: `enabled` true; `dateEnabled` true; `format24` true; `showSeconds` false; `size` 200; `dateSize` 100; `timezone` "auto".
Greeting: `enabled` true; `name` ""; `size` 100.
Search: `enabled` true; `engine` google; `placeholder` ""; `iconMode` engine; `width` 672.
Quick links: `enabled` true; `items` 8 defaults (`constants.ts:273`).
Appearance: `appearanceMode` liquid; `colorScheme` auto; `accentColor` blue; `glassIntensity` 60.

Flows (setting → consumers; writes via `updateSettings (setup-store.ts:1102)`, `updateBackground`, `updateClock/Greeting/Search/QuickLinks`):
tiles/columns/aspect/dialLayout → `dial-grid.tsx:120` (+ `dial-card:63`, `folder-preview-card:112`);
title/newtab/label/source → `dial-card.tsx:61`;
quickLinks → `quick-links.tsx:25`;
thumbnailCapture → `bookmarks-pane.tsx:94` (runtime caller UNCLEAR — not swept);
background.* → `background-layer.tsx:47`, `wallpaper.ts:141`, `page-context-menu.tsx:44`;
clock/greeting → `use-clock.ts:68`, `clock-widget.tsx:17`;
search.* → `unified-search.tsx:69`;
appearance set → `appearance-provider.tsx:57` + `appearance-pane.tsx:167`.

Panel: composable. Shell (`settings-sidebar.tsx` + `settings-motion-workspace.tsx` + `root-settings-pane.tsx`) hosts panes (`general`, `appearance`, `wallpaper`, `search`, `bookmarks`, `advanced`) built from shared primitives (`setting-row`, `select-row`, `slider-row`, `segmented-control`, `section-card`, `settings-expandable`, `range-slider`, label/feedback/tooltip/action) — all props-only, store-blind.

Persisted: all Settings + folders/cards/itemOrder/activeFolderId (`partialize :1238`). Session-only: selection, history stacks, move-dialog, image preview, nav branches, gesture capture, DnD visuals; first-paint mirror covers 9 display flags only (`first-paint-snapshot.ts:4`).

Inline-config impact: already inline-capable with minimal work — any `updateSettings/updateBackground` toggle or segmented/enum control (clock, greeting, tiles, search engine, accent, intensity) since panes are thin wrappers over store actions + reusable row primitives. Not minimal — wallpaper upload (IDB + pending/confirm flow in `wallpaper-pane.tsx`), import/export + CRUD tables (`bookmarks-pane.tsx`), reset/danger (`advanced-pane.tsx`), anything needing file pickers, multi-step dialogs, or cross-entity validation.

## Part 3 — Concrete findings

### 3.1 Hardcoded assumptions

Unions enumerating the world (`types.ts`): `BackgroundSettings.type (:47)`, `DialLayout (:120)`, `tileSize (:139)`, `AppearanceMode (:100)`, `MaterialMode (:103)`, `ColorScheme (:114)`, `AccentColor (:117)`, `WallpaperFrequency (:34)`, `iconMode (:94)`, `CardAspect (:123)`, pexels periods (`:62`); `glass.ts:230` elevation union; `switch(variant)` in `glassText/wallpaperText (:514,523,541)`; `ROLE_SHAPE: Record<GlassTier,…> (glass-surface.tsx:35)` — total over tiers, must extend per tier. Constants: tile/icon dimensions, gaps, column clamps, footer 30px, widget/size/search-width bounds (`constants.ts:144-181`), `--grid-max-width:1216px` (`tokens.css:116`). Fixed counts: icon 3×3 preview (`icon-layout.ts:71`, `dial-grid.tsx:834` ninth-slot stack), `history-dialog.tsx:28` + `search-index.ts:87` slices of 8, 8 default quick links (UNCLEAR whether the 8s are intentional parity). Order-only positioning (no coordinates anywhere). Mount-always overlays: settings subtree, per-card menu content.

### 3.2 Coupling points

Deep-store components (beyond selector reads): `dial-grid.tsx` (setup+selection+history reads AND commits/restores across all three), `selection-tray.tsx` (4 stores + history commits), `folder-tabs.tsx` (5 stores), `move-to-dialog.tsx` (consumes move-dialog + setup + history + selection in one gesture), `App.tsx` (33 setup refs + gesture-level history diffs + cross-store reconciliation). Cross-store paths: setup actions → history.commit (delete/update/combine/move); selection → tray/dialogs → setup+history; rename.cancel ← history confirmPending; image GC ← history tombstones; navigation refs ← setup activeFolderId; motion phase → sidebar mount. Undo mechanics: past/future stacks of container snapshots + card/folder patches (`history-store.ts:48-103`); `requestUndoTo/requestRedoTo` replay through the applier; pending-confirm flow (`:109-153`) gates destructive replays; dead-id notices (`:129`) when snapshots reference dropped entities; `invalidateForExternalSync` prunes branches on cross-tab writes; `clearHistory` on reset/import (`setup-store.ts:1181,1198`).
Sync mechanics: `use-cross-tab-sync.ts` subscribes `storage.onChanged`, echo-consumes own writes (`:39`), normalizes incoming, three-way merges via `mergeConcurrentSetup` (base = last-common), applies if non-empty, then invalidates history branches. Background keeps its own envelope readers for non-page contexts (`readSetupEnvelope/writeSetupEnvelope`, reset-generation honored, stale reads null).
Reset mechanics: `beginReset` bumps the generation barrier first (`storage.ts:866-871`), `cancelPendingPersist` drains the write chain (`:849-863`), state deleted, `flushPersist`, history cleared. Any write stamped below the barrier reads back as empty — post-reset saves can never resurrect dead state.
Migrations on load: legacy custom-wallpaper array → single slot (`normalizeCustomWallpaper`, orphan-blob cleanup best-effort); `itemOrder` backfilled folders-first when absent (`:605-608`); unknown wallpaper ids fall back to defaults (`normalizeBackground`).
Permission flow: `<all_urls>` is optional; `thumbnail-permission.ts` requests it explicitly for automatic capture; without it, capture degrades to favicon/gradient and manual popup capture still works. Ripple examples: `itemOrder` shape change touches ~15 setup mutators + `item-order.ts` + undo snapshots + DnD previews; `BackgroundSettings` field change touches store, normalizer, background-layer, wallpaper-pane, page-context-menu, snapshot mirror, backup format; `Card` field change touches types, normalizer, grid, card, preview, search-index, backup, history snapshots.

### 3.3 Already well-modularized

One-file edits today: any `settings/shared/*` primitive; any single settings pane (composable sections); `glass.ts` recipe fns (one role's optics); `wallpaper-snapshot.ts` / `first-paint-snapshot.ts` (self-contained mirrors); `search-index.ts`, `item-order.ts`, `folder-tree.ts`, `navigation.ts` (pure logic, store-blind); `inline-rename-input.tsx`. Theme-agnostic `packages/ui` primitives: icon tile, switch, slider, dialog, tooltip, sidebar, motion menus (take `isLiquid`/class props, never hook the store). Existing seams: chrome.storage adapter, IDB module, cross-tab merge fn, undo snapshot applier, `GlassSurface` role map, appearance context (single writer).

### 3.4 The "3-file rule" scorecard

**New theme material ("frosted") — ~25 files.** Obvious: `types.ts:100,103`, `glass.ts:46` + recipe fns, `glass-variants.ts:31,100`, `surface.ts`, `appearance-provider.tsx:95,134`, `glass-surface.tsx:94`, `tokens.css:1143`, `storage.ts:124`. Surprise: ~20 consumer ternaries that assume two outcomes (`dial-card`, `folder-preview-card`, `navigation-toolbar`, `folder-tabs*`, `toolbar-actions/icon-button`, `unified-search`, `settings-sidebar`, `empty-landing`, `quick-links`, `selection-tray`, `page-context-menu`, dialog `closeGlass` props) — each must define what frosted means; no central default exists.

**Drag-to-reposition (free x/y) — ~15 files + data migration.** Obvious: `types.ts:3,10` (new coordinate fields), `item-order.ts` (array model fights it), `dial-grid.tsx:745` (flow layout → positioned), `use-grid-dnd.ts` + marquee/drag-ghost. Surprise: all ~15 setup mutators assume sequence position, `reindexOrders` + persisted `order` must go or dual-model, undo snapshots keyed by container arrays, preview-slot math, `merge-external-setup` ordering, responsive auto-fill interplay. Already supportive: DnD plumbing, single-set mutations, snapshot undo, container scoping.

**Inline configuration (no panel) — ~6 files for easy settings, ~10+ for hard ones.** Obvious: reuse `settings/shared/*` row primitives + `updateSettings/updateBackground` actions inside `dial-card.tsx` (card-local toggles), `clock-widget.tsx` (scale), `unified-search.tsx` (engine), `appearance-pane` controls lifted as-is. Surprise: wallpaper upload state machine (`wallpaper-pane.tsx:547-749` pending/confirming), bookmark import/export tables, reset danger zone, folder-tree picker validation — these need their host flows, not just a control.

### Theme value inventory (what a new material inherits for free)

Static tokens (`apps/extension/src/styles/tokens.css`): `--ktab-accent*` (`:14`), `--ktab-glass-intensity:0.6` (`:20`), glass foregrounds light/dark (`:31,73`), `--tile-w:160px` + `--grid-gap:22px` (`:110`), `--grid-max-width:1216px` (`:116`), `--speed-dial-*` gutters/layers/spacing (`:124-156`); size overrides (`:610,614`), cell box (`:829`); breakpoints `:882,892,904,1192`; hover/pointer `:702`; reduced-motion `:855,997,1298,1437`; flat selectors gated on material (`:1143`). Runtime vars (written by `appearance-provider.tsx:116,142,146`): `--ktab-accent`, `--ktab-accent-foreground`, `--ktab-accent-rgb`, `--selection`, `--apple-blue`, `--ktab-glass-intensity`, `--ktab-glass-blur-clear/dense`, `--ktab-glass-saturation-clear/dense`, `--ktab-glass-brightness-clear/dense`; attributes `data-ktab-material`, `data-ktab-contrast` (`:134`), `dark/light` class (`:101`). Motion values (shared, theme-independent): `REORDER_TWEEN` + `reduceMotion → 0.08s` (`dial-grid.tsx:129,134`), `PAGE_VARIANTS` (`page-motion.ts:47`), travel ≤32px + duration <0.3s (`page-motion.ts:24,37,41`). Page transitions are reversible by construction: forward-initial == back-exit and forward-exit == back-initial per kind (root/depth/settings), asserted in `verify-page-motion.test.ts:12-24`; reduce-motion collapses travel to 0 with 0.08s duration (`:37-44`).
Clock ticking: `use-clock.ts:77-81` re-renders on a 1 s interval with seconds, 10 s without; time/date/greeting strings derive from the same `now` snapshot.
Persisted key set (the only keys that ever reach chrome.storage): folders, cards, activeFolderId, settings, itemOrder (`setup-store.ts:1238-1244` partialize). Everything else in the stores is memory-only.
Accent choices: blue/yellow/green/purple/pink (`storage.ts:VALID_ACCENT_COLORS`); intensity 0–100 clamped (`normalizeGlassIntensity`); appearance/colorScheme fall back to entry defaults on unknown values (`normalizeAppearanceMode`, `normalizeColorScheme`).
Dev/test harness (not shipped): `src/dev/seed` behind `import.meta.env.DEV` only (`main.tsx:19-21`); `scripts/verify-*.test.ts` (~30 files, `bun:test`, cover stores/libs/flows); `scripts/bench-*.mjs` diagnostic harnesses (never CI); interaction seeds via `buildInteractionSeed` in `bench-lib.mjs`.
Navigation model (`lib/navigation.ts`): `NavigationHistory {back[], forward[]}` (`:12-15`); `pushNavigation` appends + clears forward (`:68-78`, same-location no-op returns identical ref); `traverseBack/traverseForward` skip current + invalid ids (`:98-150`); `pruneNavigationHistory` returns identical ref when nothing pruned (`:88-96`, lets React bail out); `getNavigationState` derives direction/kind from breadcrumb paths (`:23-61`). Session-only; reconciled (not recorded) on external location changes.
Item-order toolkit (`lib/item-order.ts`): `buildItemOrder` folders-first (`:53`), `repairItemOrder` drops dangling keys (`:100`), `getOrderedRefs` merges folders+cards per container (`:179`), `reindexOrders` rewrites legacy `order` from arrays (`:211`), `removeKeysForId` (`:256`), `reorderGroupKeys` (`:270`), `insertCardsBlock` (`:294`), `containerKeyOf` maps parentId→container incl. root (`:27`).
Folder model (`lib/folder-tree.ts`): `getChildren` / `getBreadcrumb` path walks, `wouldCreateCycle` guards reparenting, `getDescendantIds` powers subtree delete + cycle-break on load; orphans reparent to root, cycles detach (`storage.ts:54-72`). External merge (`lib/merge-external-setup.ts:20`) keeps current location if valid, three-ways the rest against last-common setup.
Import flavors: Chromium/Firefox/Vivaldi bookmark HTML (`bookmarks-html.ts`) with per-flavor fixtures (`scripts/fixtures/bookmarks-{chromium,firefox,vivaldi}.html`); merge modes Keep/Replace with atomic rules; screenshots backfill over subsequent visits. Export: envelope JSON via `backup.ts` (+ image budget accounting).
Menu inventory: per-card/per-tab/per-folder menus (Open, Rename, Select, Move to…, Delete) share `glassMenu/glassDropdownItem` recipes; page menu owns background/pexels/history/rest-mode entries (`page-context-menu.tsx`); overflow tab menu adds folder search/create.
Hero stack order (all in normal page flow): ambient hero (`clock-widget` + greeting) → search anchor (`unified-search`) → quick-links rail → grid region (`App.tsx:226-277` HomeSurface); toolbar is absolute overlay (`z--[speed-dial-layer-app-toolbar]`), go-to-top absolute to the workspace frame. Shell: `SidebarProvider` + `SidebarInset` from `@ktab/ui/components/sidebar` wrap the workspace (`App.tsx`); `AnimatePresence` mounts grid generations (`dial-grid.tsx:731`), the go-to-top pill, and menu open/close.
App-level derivations: `breadcrumb` path walk → `activeRootId` (first crumb) + `rootFolders` (top-level children); `orderedRefs` per active container → `selectableItems` (union scope for select-all, never global); `pageIds` membership list for the tray; `cardCounts` per folder; `previewCards` keeps ten ordered cards per subfolder (ninth slot is the folder trigger, tenth sits underneath); wake animation `wakeActive` auto-clears after 520 ms (`triggerWake`, `ktab-wake` class). Cross-tab merge base is `lastCommonSetup.current ?? current`, so rapid local edits across a sync event diff against the freshest known common state.
MV3 worker model: event-driven service worker (no persistent background page); `onInstalled/onStartup` rebuild capture state; all chrome APIs used are `storage`, `tabs`, `contextMenus`, `bookmarks`, `activeTab`, `captureVisibleTab`, `scripting`-free (no injected code paths found); optional host access is user-gated per permission flow above.
Repo scaffolding: `bts.jsonc` records the stack decisions (`auth:none payments:none api:none backend:self dbSetup:supabase database:postgres orm:drizzle frontend:[next]`); Turbo pipelines (`turbo.json`) wire build/dev/check-types/db tasks across workspaces; bun catalog pins React 19.2.7 at root while the extension resolves 19.2.4 (minor skew, both React 19); `postinstall` runs `wxt prepare`; manifest `default_locale: en` with no `_locales/` tree (EN-only in practice); product description string "A personal browser dashboard for your new tab." lives in both manifest and package.json.
DOM/test hooks (stable selectors benches and tests drive): `data-tab-id`, `data-marquee-id`, `data-settings-open`, `data-active-folder-id`, `data-wallpaper-tile`, `data-speed-dial-scroll`, `data-settings-sidebar-slot`, `#bg-layer`, `#root`. Entry HTML shells (`newtab/index.html`, `popup/index.html`) carry only the root div + script tag; popup adds its own `style.css`.
Aria patterns: tiles/switches/menus/dialogs carry accessible names (`aria-label` on wallpaper tiles, clock switches, icon buttons; `role=menu/dialog` on overlays); verified by the quality-bar tests, not by convention alone.
Dev server: WXT port 5555 with `strictPort` (a second instance must fail fast, never silently serve a dead port); `:firefox` variants for build/zip/dev target AMO with the pinned gecko id.
Search flow: `search-index.ts` tokenizes titles/URLs/folder names (folders capped at 8, `:87`); unified-search merges local hits + engine redirect, keyboard navigable (`selectedIndex`), suggestions local-only; no network except engine favicon + optional Pexels/SVGL asset fetches.
Selection model: `selection-store` scope (page-local vs global), marquee box-select (`use-marquee-selection.ts`), range anchor (`lastSelectedId`), tray bulk ops, Space toggles in selection mode (`dial-card.tsx:144-155`), blank-surface pointerdown clears (`App.tsx:1103-1118`).
Settings motion: phases closed→open→closing→closed (`settings-motion-store.ts:7,31-34`); `layoutOpen = phase !== "closed"` drives workspace padding + frame transform together (one store update, no rAF gap); `finishClose` fires from transition end; sidebar unmounts when closed (P2), mount-open skips initial inert.
Toast/error surface: `usePersistenceErrorToast` subscribes `subscribeToPersistHealth` → one restrained toast on `failed`; `history-manager` toasts pending/undo/dead-id notices; `ThemedToaster` follows app theme explicitly (never OS).
App gesture handlers (`entrypoints/newtab/App.tsx`, all single-set + one history entry): combine cards into subfolder (`:694-722`, capture→create→diff→clear→rename); live reorder (`:724-734`); move items (`:736-741`); reorder group (`:743-753`); insert/preview-drop (`:755-777`); tab drop multi-aware (`:785-848`, frozen groups, mixed kinds never half-moved); new subfolder Vivaldi-style (`:881-902`, create→navigate→rename); move-folder-to-root (`:906-924`); tab reorder preview-then-commit (`:930-965`, hovers write order-array only, drop commits once).
Background resolve cascade (`background-layer.tsx:124-193`): preview image > pexels cache > cache-recovery refresh > stored imageId > packaged wallpaper (pre-decoded) > gradient > color fallback; generation counter + `isCurrent` guard drops stale async resolutions (`:118-122`).
Compact search: scroll listener (passive) + rAF coalescing flips `compactSearch` at the search-anchor/toolbar boundary (`App.tsx:1035-1072`); `data-compact-search` drives the toolbar affordance; rest mode (`useState(false)`, Esc/Enter/Space exit `:660-661`) hides Home chrome via `rest-mode-hidden`.
Settings deep-linking: `open(pane, action)` (`settings-motion-store.ts:31`) carries pane + initial action (e.g. add-link) through `SettingsMotionSidebar` props into pane navigation state.

### UNCLEAR registry (explicitly ambiguous — not guessed)

1. `wallpaper-pane.tsx` indirect material branch via preview rendering — preview path not fully traced.
2. `advanced-pane.tsx` export path (`resetAll` traced; export flow not traced).
3. `settings-feedback.tsx` behavior beyond its name — file not read fully.
4. `settings-motion-store` full reader list beyond the 7 App + 9 workspace refs swept.
5. Exhaustive `switch(isLiquid|mode)` count — most branches are ternaries, not `switch` statements.
6. Viewport-width reads outside swept files — none found, not proven absent.
7. Built chunk filenames/sizes — no build was run in this survey.
8. The three slices of 8 (`history-dialog.tsx:28`, `search-index.ts:87`, 8 default quick links) — intentional parity or coincidence, unknown.
9. `thumbnailCapture` runtime caller — referenced in `bookmarks-pane.tsx:94`, call site not swept.
10. `settings-sidebar.tsx:270` `history.getState().pending` read — purpose not traced.
