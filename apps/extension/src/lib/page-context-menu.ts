const PAGE_CONTEXT_MENU_CONTENT_SELECTOR = [
	"[data-local-context-menu]",
	"[data-widget]",
	"[data-widget-slot-id]",
	"[data-speed-dial-app-toolbar]",
	"[data-settings-panel]",
	"[data-settings-ui]",
	"[data-quick-links]",
	"[data-search-overlay]",
	"button",
	"a[href]",
	"input",
	"textarea",
	"select",
	"summary",
	"img",
	"svg",
	"video",
	"canvas",
	"h1",
	"h2",
	"h3",
	"h4",
	"p",
	"label",
	"kbd",
	"li",
	"[role]",
	"[contenteditable='true']",
].join(",");

/** True only when the contextmenu hit an unoccupied page surface. */
export function isPageBackgroundContextMenuTarget(
	target: EventTarget | null,
): boolean {
	if (!target || typeof (target as Element).closest !== "function")
		return false;
	const element = target as Element;
	if (element.closest(PAGE_CONTEXT_MENU_CONTENT_SELECTOR)) return false;
	return !(element.childElementCount === 0 && element.textContent?.trim());
}
