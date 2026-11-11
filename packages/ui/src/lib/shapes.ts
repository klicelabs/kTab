/**
 * kTab's shared corner language.
 *
 * Each role reads a semantic variable pair from tokens.css (--shape-*), so
 * the Settings corner scale drives every role at once and no consumer ever
 * picks a rounded-* utility by feel. Chromium renders corner-shape: squircle
 * from the radius; the paired fallback var keeps the calibrated Gecko
 * radius. Search has independent field and results surfaces: both keep
 * the user's corner scale. Discreet/Soft fields use the section's calibrated
 * squircle; Rounded fields are true capsules. Results keep their squircle.
 * Toolbar controls remain circular capsules.
 *
 * Consumers should use a role rather than choosing a rounded-* utility.
 */
const SURFACE_SHAPE =
	"ktab-squircle rounded-[var(--shape-surface,18px)] [--squircle-r:var(--shape-surface-fallback,11px)]";

export const KtabShape = {
	panel:
		"ktab-squircle rounded-[var(--shape-panel,28px)] [--squircle-r:var(--shape-panel-fallback,17px)]",
	section:
		"ktab-squircle rounded-[var(--shape-section,22px)] [--squircle-r:var(--shape-section-fallback,13px)]",
	surface: SURFACE_SHAPE,
	/** Bookmark/folder cards: the grid's primary surface silhouette. */
	card: "ktab-squircle rounded-[var(--shape-card,18px)] [--squircle-r:var(--shape-card-fallback,10px)]",
	control:
		"ktab-squircle rounded-[var(--shape-control,16px)] [--squircle-r:var(--shape-control-fallback,10px)]",
	thumbnail:
		"ktab-squircle rounded-[var(--shape-thumb,12px)] [--squircle-r:var(--shape-thumb-fallback,7px)]",
	/** Small badges and segmented controls. */
	pill: "ktab-squircle rounded-[var(--shape-pill,14px)] [--squircle-r:var(--shape-pill-fallback,9px)]",
	/**
	 * Shared 34px toolbar surface. Always a true pill/capsule
	 * (`.ktab-toolbar-pill`), never squircle.
	 */
	toolbar: "ktab-toolbar-pill rounded-full",
	/**
	 * Shared toolbar segment. Always a true pill/capsule
	 * (`.ktab-toolbar-pill`), never squircle.
	 */
	toolbarControl: "ktab-toolbar-pill rounded-full",
	/**
	 * Shared 34px icon control. Always a true pill/capsule
	 * (`.ktab-toolbar-pill`), never squircle.
	 */
	toolbarIcon: "ktab-toolbar-pill rounded-full",
	/**
	 * Outer shell of a grouped toolbar control (e.g. Back/Forward). Resolves
	 * to the same capsule as every other toolbar pill: the outer ends of the
	 * first/last segment inherit this geometry (see `.ktab-button-group` in
	 * globals.css), so the surface and its segments can never disagree.
	 */
	toolbarGroup: "ktab-toolbar-group rounded-full",
	/** Search field: finite tier radius with the section's Gecko calibration. */
	searchCollapsed:
		"ktab-search-surface ktab-squircle rounded-[var(--shape-search-collapsed,28px)] [--squircle-r:var(--shape-section-fallback,13px)]",
	/** Results match the field in Soft/Discreet; Rounded keeps a softer panel. */
	searchResults:
		"ktab-squircle rounded-[var(--shape-search-results,22px)] [--squircle-r:var(--shape-search-results-fallback,13px)]",
	/** Default search material geometry; detached result panels use panel. */
	searchExpanded: `${SURFACE_SHAPE} ktab-search-surface`,
} as const;

export type KtabShapeName = keyof typeof KtabShape;

export function ktabShape(shape: KtabShapeName): string {
	return KtabShape[shape];
}
