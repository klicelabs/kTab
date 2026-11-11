"use client";

import { Icon } from "@ktab/ui/icons/icon";
import { ktabShape } from "@ktab/ui/lib/shapes";
import {
	type CSSProperties,
	forwardRef,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useSvgIcon } from "../../../hooks/use-svg-icon";
import { SEARCH_ENGINES } from "../../../lib/constants";
import { getBreadcrumb } from "../../../lib/folder-tree";
import { glassForeground } from "../../../lib/glass";
import { createSearchIndex } from "../../../lib/search-index";
import { SEARCH_ENGINE_TO_SVGL } from "../../../lib/svgl-mapping";
import { faviconUrl } from "../../../lib/url";
import { cn } from "../../../lib/utils";
import { fetchAllSvgs } from "../../../services/svgl";
import { useSetupStore } from "../../../stores/setup-store";
import { SvgIcon } from "../../shared/svg-icon";
import { useAppearance } from "../appearance-provider";
import { GlassSurface } from "../toolbar/glass-surface";
import { searchAccess } from "./search-access";
import {
	createDestinationIndex,
	type SiteDestination,
} from "./search-destinations";
import { SearchResultIcon } from "./search-result-icon";
import {
	activeSearchIndex,
	buildSearchGroups,
	type SearchItem,
	type SearchScope,
} from "./search-results";
import {
	EMPTY_SUGGESTIONS,
	getSearchSuggestions,
	type SearchSuggestions,
} from "./search-suggestions";
import {
	buildTemplateSearchUrl,
	resolveSearchTemplate,
	type SearchTemplate,
} from "./search-templates";
import { useSearchPosition } from "./use-search-position";
import {
	canRestoreSearchFocus,
	SEARCH_TRANSITION_MS,
	useSearchPresence,
} from "./use-search-presence";

export interface UnifiedSearchHandle {
	focus: () => void;
	toggle: () => void;
}
interface UnifiedSearchProps {
	onNavigateFolder: (id: string) => void;
}
const SCOPES: { id: SearchScope; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "saved", label: "Saved" },
	{ id: "folders", label: "Folders" },
	{ id: "web", label: "Web" },
];

function displayHost(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

export const UnifiedSearch = forwardRef<
	UnifiedSearchHandle,
	UnifiedSearchProps
>(function UnifiedSearch({ onNavigateFolder }, ref) {
	const { isLiquid } = useAppearance();
	const search = useSetupStore((s) => s.settings.search);
	const { available } = searchAccess(search);
	const openInNewTab = useSetupStore((s) => s.settings.openInNewTab);
	const quickLinks = useSetupStore((s) => s.settings.quickLinks.items);
	const cards = useSetupStore((s) => s.cards);
	const folders = useSetupStore((s) => s.folders);
	const [query, setQuery] = useState("");
	const { phase, open, present, show, hide } = useSearchPresence();
	const [scope, setScope] = useState<SearchScope>("all");
	const [activeTemplate, setActiveTemplate] = useState<SearchTemplate | null>(
		null,
	);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [catalogue, setCatalogue] = useState<SiteDestination[]>([]);
	const [response, setResponse] = useState<{
		query: string;
		engineId: string;
		values: SearchSuggestions;
	} | null>(null);
	const [logoFailedFor, setLogoFailedFor] = useState<string | null>(null);
	const anchorRef = useRef<HTMLDivElement>(null);
	const launcherRef = useRef<HTMLButtonElement>(null);
	const overlayRef = useRef<HTMLElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const restoreFocusRef = useRef(false);
	const wasPresent = useRef(false);
	const restoreFrameRef = useRef<number | null>(null);
	const focusVersionRef = useRef(0);
	const phaseRef = useRef(phase);
	phaseRef.current = phase;
	const cancelFocusReturn = useCallback(() => {
		restoreFocusRef.current = false;
		focusVersionRef.current += 1;
		if (restoreFrameRef.current !== null)
			cancelAnimationFrame(restoreFrameRef.current);
		restoreFrameRef.current = null;
	}, []);
	useEffect(() => cancelFocusReturn, [cancelFocusReturn]);
	useEffect(() => {
		const newerIntent = () => {
			if (phaseRef.current !== "open" && restoreFocusRef.current)
				cancelFocusReturn();
		};
		document.addEventListener("pointerdown", newerIntent, true);
		document.addEventListener("keydown", newerIntent, true);
		return () => {
			document.removeEventListener("pointerdown", newerIntent, true);
			document.removeEventListener("keydown", newerIntent, true);
		};
	}, [cancelFocusReturn]);
	const engine =
		SEARCH_ENGINES.find((item) => item.id === search.engine) ??
		SEARCH_ENGINES[0];
	const placeholder =
		search.placeholder.trim() || "Search saved pages or the web";
	const { svgXml, isLoading } = useSvgIcon(
		available && search.iconMode === "engine"
			? SEARCH_ENGINE_TO_SVGL[search.engine]
			: null,
	);
	const index = useMemo(
		() => createSearchIndex(cards, folders),
		[cards, folders],
	);
	const local = useMemo(() => index(query), [index, query]);
	const folderCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const card of cards)
			counts.set(card.folderId, (counts.get(card.folderId) ?? 0) + 1);
		return counts;
	}, [cards]);
	const paths = useMemo(
		() =>
			new Map(
				folders.map((folder) => [
					folder.id,
					getBreadcrumb(folders, folder.id)
						.map((part) => part.name)
						.join(" / "),
				]),
			),
		[folders],
	);
	const findDestination = useMemo(
		() => createDestinationIndex(catalogue),
		[catalogue],
	);
	const destination = useMemo(
		() => findDestination(query),
		[findDestination, query],
	);
	const templateCandidate = activeTemplate
		? null
		: resolveSearchTemplate(query);
	const suggestions =
		response?.query === query && response.engineId === engine.id
			? response.values
			: EMPTY_SUGGESTIONS;
	const groups = useMemo(() => {
		if (activeTemplate) {
			const searchQuery = query.trim();
			return searchQuery
				? [
						{
							id: "site-search",
							label: activeTemplate.label,
							items: [
								{
									type: "web" as const,
									id: `site-search:${activeTemplate.id}`,
									query: searchQuery,
								},
							],
						},
					]
				: [];
		}
		return buildSearchGroups({
			query,
			scope,
			local,
			cards,
			folders,
			quickLinks,
			destination,
			suggestions: suggestions.queries,
			navigation: suggestions.navigation,
		});
	}, [
		activeTemplate,
		query,
		scope,
		local,
		cards,
		folders,
		quickLinks,
		destination,
		suggestions,
	]);
	const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
	const activeIndex = activeSearchIndex(items, activeId, !!query.trim());
	const activeItem = items[activeIndex];
	const isMac =
		typeof navigator !== "undefined" &&
		/Mac|iPhone|iPad/.test(navigator.platform);
	const ink = isLiquid ? glassForeground() : "text-foreground";

	useSearchPosition(
		present,
		search.width,
		anchorRef,
		overlayRef,
		search.enabled,
	);

	const openSearch = useCallback(() => {
		if (!available) return;
		if (!open)
			returnFocusRef.current =
				document.activeElement instanceof HTMLElement &&
				document.activeElement !== document.body
					? document.activeElement
					: null;
		cancelFocusReturn();
		show();
		inputRef.current?.focus({ preventScroll: true });
	}, [open, available, show, cancelFocusReturn]);
	useLayoutEffect(() => {
		if (open) inputRef.current?.focus({ preventScroll: true });
	}, [open]);

	const close = useCallback(
		(restoreFocus = false, immediate = false) => {
			cancelFocusReturn();
			restoreFocusRef.current = restoreFocus;
			inputRef.current?.blur();
			hide(immediate);
		},
		[hide, cancelFocusReturn],
	);
	useImperativeHandle(
		ref,
		() => ({
			focus: openSearch,
			toggle: () => {
				if (open) close();
				else openSearch();
			},
		}),
		[open, close, openSearch],
	);
	useEffect(() => {
		if (present) {
			wasPresent.current = true;
			return;
		}
		if (!wasPresent.current) return;
		wasPresent.current = false;
		setQuery("");
		setScope("all");
		setActiveTemplate(null);
		setActiveId(null);
		setResponse(null);
		if (restoreFocusRef.current) {
			const trigger = returnFocusRef.current;
			const requestedVersion = focusVersionRef.current;
			restoreFrameRef.current = requestAnimationFrame(() => {
				restoreFrameRef.current = null;
				const active = document.activeElement;
				if (
					!restoreFocusRef.current ||
					!canRestoreSearchFocus(
						phaseRef.current,
						requestedVersion,
						focusVersionRef.current,
						!active ||
							active === document.body ||
							active === document.documentElement,
					)
				)
					return;
				if (trigger?.isConnected && trigger.getClientRects().length)
					trigger.focus({ preventScroll: true });
				else if (search.enabled)
					launcherRef.current?.focus({ preventScroll: true });
				else
					document
						.querySelector<HTMLButtonElement>("[data-compact-search-control]")
						?.focus({ preventScroll: true });
			});
		}
	}, [present, search.enabled]);

	useEffect(() => {
		if (!available) close(false, true);
	}, [available, close]);
	useEffect(() => {
		if (!present) return;
		const outside = (event: PointerEvent) => {
			const target = event.target;
			if (
				!(target instanceof Node) ||
				overlayRef.current?.contains(target) ||
				anchorRef.current?.contains(target) ||
				(target instanceof Element &&
					target.closest("[data-compact-search-control]"))
			)
				return;
			close();
		};
		document.addEventListener("pointerdown", outside);
		return () => {
			document.removeEventListener("pointerdown", outside);
		};
	}, [present, close]);
	useEffect(() => {
		if (!open || !available) return;
		let cancelled = false;
		// Reuse the icon catalogue's cache. No query is sent to this service.
		void fetchAllSvgs()
			.then((sites) => {
				if (!cancelled && Array.isArray(sites)) setCatalogue(sites);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [open, available]);
	useEffect(() => {
		if (!open || !available) return;
		setResponse(null);
		if (
			activeTemplate ||
			templateCandidate ||
			query.trim().length < 2 ||
			(scope !== "all" && scope !== "web")
		)
			return;
		const controller = new AbortController();
		const timer = window.setTimeout(() => {
			void getSearchSuggestions(engine, query, controller.signal).then(
				(values) => {
					if (!controller.signal.aborted)
						setResponse({ query, engineId: engine.id, values });
				},
			);
		}, 180);
		return () => {
			controller.abort();
			window.clearTimeout(timer);
		};
	}, [
		activeTemplate,
		templateCandidate,
		engine,
		open,
		query,
		scope,
		available,
	]);

	const navigate = useCallback(
		(url: string) => {
			window.open(
				url,
				openInNewTab ? "_blank" : "_self",
				"noopener,noreferrer",
			);
			close();
		},
		[openInNewTab, close],
	);
	const selectItem = (item: SearchItem) => {
		if (activeTemplate && (item.type === "web" || item.type === "suggestion")) {
			navigate(buildTemplateSearchUrl(activeTemplate, item.query));
			return;
		}
		switch (item.type) {
			case "folder":
				onNavigateFolder(item.data.id);
				close();
				break;
			case "bookmark":
			case "quick-link":
				navigate(item.data.url);
				break;
			case "url":
				navigate(item.url);
				break;
			case "web":
			case "suggestion":
				navigate(engine.queryUrl.replace("%s", encodeURIComponent(item.query)));
				break;
		}
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.nativeEvent.isComposing) return;
		if (
			event.key === "Tab" &&
			!event.shiftKey &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey &&
			templateCandidate
		) {
			event.preventDefault();
			setActiveTemplate(templateCandidate);
			setQuery("");
			setActiveId(null);
			setResponse(null);
			return;
		}
		if (event.key === "Backspace" && activeTemplate && query === "") {
			event.preventDefault();
			setActiveTemplate(null);
			setScope("all");
			setActiveId(null);
			setResponse(null);
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close(true);
			return;
		}
		if (
			(event.key === "ArrowDown" || event.key === "ArrowUp") &&
			items.length
		) {
			event.preventDefault();
			const next =
				activeIndex < 0
					? event.key === "ArrowDown"
						? 0
						: items.length - 1
					: (activeIndex +
							(event.key === "ArrowDown" ? 1 : -1) +
							items.length) %
						items.length;
			setActiveId(items[next]?.id ?? null);
		} else if (event.key === "Enter") {
			event.preventDefault();
			if (activeItem) selectItem(activeItem);
		}
	};
	useLayoutEffect(() => {
		const list = listRef.current;
		if (!open || !list) return;
		if (!items[activeIndex]) {
			list.scrollTop = 0;
			return;
		}
		const active = list?.querySelector<HTMLElement>(
			`[data-search-index="${activeIndex}"]`,
		);
		if (!active) return;
		const viewport = list.getBoundingClientRect();
		const rect = active.getBoundingClientRect();
		if (rect.top < viewport.top) list.scrollTop -= viewport.top - rect.top;
		else if (rect.bottom > viewport.bottom)
			list.scrollTop += rect.bottom - viewport.bottom;
	}, [open, activeIndex, items]);

	if (!available) return null;
	const engineIcon =
		search.iconMode === "engine" && logoFailedFor !== search.engine;
	const icon =
		engineIcon && svgXml && !isLoading ? (
			<SvgIcon svgXml={svgXml} className="size-5 shrink-0" alt={engine.label} />
		) : engineIcon ? (
			<img
				src={faviconUrl(engine.homepage)}
				alt=""
				className="size-5 shrink-0"
				onError={() => setLogoFailedFor(search.engine)}
			/>
		) : (
			<Icon name="search" size={20} aria-hidden="true" />
		);
	const describe = (item: SearchItem) => {
		switch (item.type) {
			case "bookmark":
				return {
					title: item.data.title || displayHost(item.data.url),
					detail: `${displayHost(item.data.url)}${paths.get(item.data.folderId) ? ` · ${paths.get(item.data.folderId)}` : ""}`,
					url: item.data.url,
					favicon: item.data.favicon,
					icon: "globe" as const,
				};
			case "quick-link":
				return {
					title: item.data.label,
					detail: displayHost(item.data.url),
					url: item.data.url,
					icon: "link" as const,
				};
			case "folder":
				return {
					title: item.data.name,
					detail: `${paths.get(item.data.parentId ?? "") || "Your folders"} · ${folderCounts.get(item.data.id) ?? 0} saved`,
					icon: "folder" as const,
				};
			case "url":
				return {
					title: item.title || `Open ${displayHost(item.url)}`,
					detail: item.title ? displayHost(item.url) : item.url,
					url: item.url,
					icon: "external-link" as const,
				};
			case "web":
				return {
					title: item.query,
					detail: activeTemplate
						? `Search ${activeTemplate.label}`
						: `Search with ${engine.label}`,
					icon: "search" as const,
				};
			case "suggestion":
				return {
					title: item.query,
					detail: engine.label,
					icon: "search" as const,
				};
		}
	};
	let rowIndex = 0;
	return (
		<div
			ref={anchorRef}
			hidden={!search.enabled}
			data-unified-search
			data-search-open={open ? "true" : "false"}
			className="ktab-search-anchor"
			style={
				{
					"--speed-dial-search-width": `${search.width}px`,
					width: "min(var(--speed-dial-search-width), 100%)",
				} as CSSProperties
			}
		>
			<GlassSurface
				variant="hero"
				shape="searchCollapsed"
				className={cn("ktab-search-field", present && "invisible")}
			>
				<button
					ref={launcherRef}
					type="button"
					onClick={openSearch}
					aria-label="Search saved pages or the web"
					aria-haspopup="listbox"
					aria-expanded={open}
					className={cn("ktab-search-launcher", ink)}
				>
					{icon}
					<span className="min-w-0 flex-1 truncate text-left opacity-65">
						{placeholder}
					</span>
					{search.quickAccessEnabled && <kbd>{isMac ? "⌘ K" : "Ctrl K"}</kbd>}
				</button>
			</GlassSurface>
			{present &&
				createPortal(
					<search
						ref={overlayRef}
						aria-label="Search"
						className={cn("ktab-search-overlay", ink)}
						data-search-overlay
						data-search-state={phase}
						style={
							{
								"--search-motion-duration": `${SEARCH_TRANSITION_MS}ms`,
							} as CSSProperties
						}
						aria-hidden={!open}
						inert={!open}
						data-local-context-menu
						onKeyDown={(event) => {
							if (event.nativeEvent.isComposing) return;
							if (event.key === "Escape") {
								event.preventDefault();
								event.stopPropagation();
								close(true);
							}
						}}
						onBlurCapture={(event) => {
							if (
								event.relatedTarget instanceof Node &&
								!event.currentTarget.contains(event.relatedTarget) &&
								!(
									event.relatedTarget instanceof Element &&
									event.relatedTarget.closest("[data-compact-search-control]")
								)
							)
								close();
						}}
					>
						<GlassSurface
							variant="hero"
							shape="searchCollapsed"
							className="ktab-search-field"
						>
							<form
								className="ktab-search-input-row"
								onSubmit={(event) => {
									event.preventDefault();
									if (activeItem) selectItem(activeItem);
								}}
							>
								{icon}
								{activeTemplate && (
									<button
										type="button"
										className={cn(
											"ktab-search-template-badge",
											ktabShape("pill"),
										)}
										aria-label={`Remove ${activeTemplate.label} search`}
										title={`Remove ${activeTemplate.label} search`}
										onClick={() => {
											setActiveTemplate(null);
											setQuery("");
											setScope("all");
											setActiveId(null);
											setResponse(null);
											inputRef.current?.focus({ preventScroll: true });
										}}
									>
										<span>{activeTemplate.label}</span>
										<Icon name="x" size={12} aria-hidden="true" />
									</button>
								)}
								<input
									ref={inputRef}
									data-unified-search-input
									type="text"
									role="combobox"
									value={query}
									onChange={(event) => {
										setQuery(event.target.value);
										setActiveId(null);
									}}
									onKeyDown={handleKeyDown}
									placeholder={
										activeTemplate
											? `Search ${activeTemplate.label}`
											: placeholder
									}
									aria-label={
										activeTemplate
											? `Search ${activeTemplate.label}`
											: "Search saved pages or the web"
									}
									aria-expanded={open}
									aria-controls="ktab-search-results"
									aria-activedescendant={
										activeItem ? `ktab-search-option-${activeIndex}` : undefined
									}
									aria-autocomplete="list"
									aria-describedby={
										[
											templateCandidate && query.trim()
												? "ktab-search-template-hint"
												: null,
											!items.length ? "ktab-search-empty-help" : null,
										]
											.filter(Boolean)
											.join(" ") || undefined
									}
									autoComplete="off"
									autoCapitalize="off"
									spellCheck={false}
								/>
								{templateCandidate && query.trim() && (
									<span
										id="ktab-search-template-hint"
										className="ktab-search-tab-hint"
										title={`Search ${templateCandidate.label}`}
									>
										<kbd>Tab</kbd>
										<span>{templateCandidate.label}</span>
									</span>
								)}
								{query ? (
									<button
										type="button"
										aria-label="Clear search"
										className="ktab-search-dismiss"
										onClick={() => {
											setQuery("");
											setActiveId(null);
											inputRef.current?.focus({ preventScroll: true });
										}}
									>
										<Icon name="x" size={16} />
									</button>
								) : (
									<button
										type="button"
										aria-label="Close search"
										className="ktab-search-dismiss"
										onClick={() => close(true)}
									>
										<kbd>Esc</kbd>
									</button>
								)}
							</form>
						</GlassSurface>
						<GlassSurface
							variant="search"
							shape="searchResults"
							className="ktab-search-results-panel"
						>
							{!activeTemplate && (
								<fieldset className="ktab-search-scopes" aria-label="Search in">
									{SCOPES.map((filter) => (
										<button
											type="button"
											key={filter.id}
											aria-pressed={scope === filter.id}
											className={cn("ktab-search-scope", ktabShape("pill"))}
											onClick={() => {
												setScope(filter.id);
												setActiveId(null);
												inputRef.current?.focus({ preventScroll: true });
											}}
										>
											{filter.label}
										</button>
									))}
								</fieldset>
							)}
							<div ref={listRef} className="ktab-search-results-list">
								<div
									id="ktab-search-results"
									role="listbox"
									aria-label="Search results"
								>
									{groups.map((group) => (
										// biome-ignore lint/a11y/useSemanticElements: this is an ARIA listbox option group, not a form fieldset.
										<div
											key={group.id}
											role="group"
											aria-label={group.label}
											className="ktab-search-result-group"
										>
											{group.items.map((item) => {
												const index = rowIndex++;
												const selected = index === activeIndex;
												const content = describe(item);
												return (
													<button
														key={item.id}
														type="button"
														role="option"
														aria-selected={selected}
														tabIndex={-1}
														id={`ktab-search-option-${index}`}
														data-search-index={index}
														className={cn(
															"ktab-search-option",
															ktabShape("control"),
														)}
														onMouseEnter={() => setActiveId(item.id)}
														onPointerDown={(event) => {
															if (event.pointerType === "mouse")
																event.preventDefault();
														}}
														onClick={() => selectItem(item)}
													>
														<SearchResultIcon
															url={content.url}
															favicon={content.favicon}
															icon={content.icon}
														/>
														<span className="ktab-search-result-copy">
															<span>{content.title}</span>
															<small>{content.detail}</small>
														</span>
														<Icon
															name={
																item.type === "folder"
																	? "chevron-right"
																	: "external-link"
															}
															size={15}
															aria-hidden="true"
															className="ktab-search-row-action"
														/>
													</button>
												);
											})}
										</div>
									))}
								</div>
								{!items.length && (
									<div className="ktab-search-empty">
										<Icon name="search" size={22} aria-hidden="true" />
										<p role="status">
											{activeTemplate
												? `Search on ${activeTemplate.label}`
												: query.trim()
													? `No ${scope === "folders" ? "folders" : "saved pages"} found`
													: scope === "web"
														? `Search with ${engine.label}`
														: "Your library starts here"}
										</p>
										<span id="ktab-search-empty-help">
											{activeTemplate
												? "Type a query and press Enter to search this site."
												: query.trim()
													? "Try a shorter name, a website, or search the web."
													: scope === "web"
														? "Type a question, a search, or a website address."
														: "Save a page or add a folder to find it here."}
										</span>
										{query.trim() && (
											<button
												type="button"
												onClick={() => {
													setScope("web");
													setActiveId(null);
													inputRef.current?.focus();
												}}
											>
												Search the web instead
												<Icon name="external-link" size={14} />
											</button>
										)}
									</div>
								)}
							</div>
							<div className="ktab-search-footer">
								<span role="status" aria-live="polite">
									{activeTemplate
										? `Search ${activeTemplate.label}`
										: query.trim()
											? `${items.length} ${items.length === 1 ? "result" : "results"}`
											: "Find your next destination"}
								</span>
								<button
									type="button"
									className="ktab-search-go"
									disabled={!activeItem}
									onClick={() => {
										if (activeItem) selectItem(activeItem);
									}}
								>
									{activeTemplate ? "Search" : "Open"} <kbd>↵</kbd>
								</button>
							</div>
						</GlassSurface>
					</search>,
					document.body,
				)}
		</div>
	);
});
