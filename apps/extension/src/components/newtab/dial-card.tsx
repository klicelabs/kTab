import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@ktab/ui/components/motion/context-menu";
import { Icon } from "@ktab/ui/icons/icon";
import { DURATION, EASE } from "@ktab/ui/lib/motion";
import { ktabShape } from "@ktab/ui/lib/shapes";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useResolvedIcon } from "../../hooks/use-resolved-icon";
import { CARD_FOOTER_VARIANT, cardFooterMaterial } from "../../lib/card-footer";
import { renameCardTitle, resolveCardTitle } from "../../lib/card-title";
import type { GridItemDragProps } from "../../lib/dnd";
import {
	glassCardMaterial,
	glassDropdownItem,
	glassDropRing,
	glassFocusRing,
	glassMenu,
} from "../../lib/glass";
import { expandSelectionToCards } from "../../lib/selection-model";
import { REFRESH_STRINGS } from "../../lib/thumbnail-refresh";
import {
	startBatchRefresh,
	startSingleRefresh,
} from "../../lib/thumbnail-refresh-client";
import {
	deriveInitialLetter,
	faviconUrl,
	isAbsoluteHttpUrl,
} from "../../lib/url";
import { cn, softGradientFromString } from "../../lib/utils";
import { useImageStore } from "../../stores/image-store";
import { useMoveDialogStore } from "../../stores/move-dialog-store";
import { useRefreshStore } from "../../stores/refresh-store";
import { useRenameStore } from "../../stores/rename-store";
import { useSelectionStore } from "../../stores/selection-store";
import { useSetupStore } from "../../stores/setup-store";
import type { Card, Folder } from "../../types";
import { InlineRenameInput } from "../shared/inline-rename-input";
import { SvgIcon } from "../shared/svg-icon";
import { useAppearance } from "./appearance-provider";
import { ICON_MODE_SURFACE_CLASS, IconModeTile } from "./icon-mode-tile";
import { SelectionCheckbox } from "./selection-checkbox";
import { ThumbnailFeedback } from "./thumbnail-feedback";

interface DialCardProps {
	card: Card;
	onDelete: (id: string) => void;
	isSelected?: boolean;

	onClick?: (e: React.MouseEvent) => void;
	onSelect?: (e: React.MouseEvent) => void;
	dragProps?: GridItemDragProps;
	/** Live insertion marker drawn on the card's leading/trailing edge. */
	insertion?: "before" | "after" | null;
	/** Drop-onto highlight: this card is the combine target. */
	combineActive?: boolean;
	dragging?: boolean;
	className?: string;
}

export function DialCard({
	card,
	onDelete,
	isSelected = false,
	onClick,
	onSelect,
	dragProps,
	insertion = null,
	combineActive = false,
	dragging = false,
	className,
}: DialCardProps) {
	const { isLiquid, resolvedDark } = useAppearance();
	const getThumbnail = useImageStore((s) => s.getThumbnail);
	const openInNewTab = useSetupStore((s) => s.settings.openInNewTab);
	const showTitle = useSetupStore((s) => s.settings.showTitle);
	const dialLayout = useSetupStore((s) => s.settings.dialLayout);
	const iconShowLabel = useSetupStore((s) => s.settings.iconShowLabel);
	const iconTileSurface = useSetupStore((s) => s.settings.iconTileSurface);
	const defaultTitleSource = useSetupStore(
		(s) => s.settings.defaultTitleSource,
	);
	const initialThumbId = useRef(card.thumbId);
	const [thumbnail, setThumbnail] = useState<{
		id: string;
		url: string;
		previous?: { id: string; url: string };
	} | null>(null);
	const reduceMotion = useReducedMotion();
	const [decoding, setDecoding] = useState(false);

	const editing = useRenameStore((s) => s.isEditing("card", card.id));
	const beginRename = useRenameStore((s) => s.begin);
	const cancelRename = useRenameStore((s) => s.cancel);
	const openMoveDialog = useMoveDialogStore((s) => s.open);
	const refreshState = useRefreshStore((s) =>
		s.currentCardId === card.id
			? "capturing"
			: s.queuedIds.includes(card.id)
				? "queued"
				: "idle",
	);
	const refreshCapturing = refreshState === "capturing";
	// Selection-aware refresh: a right-click on a selected card acts on the
	// whole selection — cards directly selected plus every bookmark inside
	// selected folders (recursive expansion, same rule as the tray) — while
	// anywhere else it acts on this card alone. Refresh is card-mode only —
	// icon tiles have no thumb surface, so the entry (and the overlay below)
	// hides there.
	const selectionIds = useSelectionStore((s) => s.selectedIds);
	const cards = useSetupStore((s) => s.cards as Card[]);
	const folders = useSetupStore((s) => s.folders as Folder[]);
	const instanceSelected = selectionIds.includes(card.id);
	const refreshTargets = useMemo(
		() =>
			instanceSelected
				? expandSelectionToCards(selectionIds, cards, folders)
				: [],
		[instanceSelected, selectionIds, cards, folders],
	);
	const refreshCount = refreshTargets.length || 1;
	function handleRefreshCard() {
		if (instanceSelected && refreshTargets.length > 1)
			void startBatchRefresh(refreshTargets);
		else void startSingleRefresh(card.id);
	}

	useEffect(() => {
		let cancelled = false;
		const id = card.thumbId;
		if (!id) {
			setThumbnail(null);
			setDecoding(false);
			return;
		}
		setDecoding(true);
		void getThumbnail(id)
			.then(async (url) => {
				if (!url || cancelled) return;
				const image = new Image();
				image.src = url;
				await image.decode();
				if (!cancelled)
					setThumbnail((current) => ({
						id,
						url,
						previous: current
							? { id: current.id, url: current.url }
							: undefined,
					}));
			})
			.catch(() => {
				// An unreadable replacement never removes a working preview.
			})
			.finally(() => {
				if (!cancelled) setDecoding(false);
			});
		return () => {
			cancelled = true;
		};
	}, [card.thumbId, getThumbnail]);

	const fallbackColor = softGradientFromString(card.url);
	const faviconSrc = card.favicon || faviconUrl(card.url);
	// Card mode upgrades use the same resolver as the launcher, but stay
	// presentation-only: thumbnails remain the primary body and card.favicon
	// on disk is never rewritten.
	const resolvedFavicon = useResolvedIcon(card.url, {
		explicitFavicon: card.favicon ?? undefined,
	});
	const label = resolveCardTitle(card, defaultTitleSource);
	const savedTitle = card.title || card.url;

	function handleOpenNewTab() {
		if (!isAbsoluteHttpUrl(card.url)) return;
		// pi-lens-ignore: no-open-redirect
		window.open(card.url, "_blank", "noopener,noreferrer");
	}

	function handleCommitRename(name: string) {
		useSetupStore
			.getState()
			.updateCard(card.id, renameCardTitle(name), { history: true });
		cancelRename();
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger
				data-selected={isSelected ? "true" : undefined}
				data-dragging={dragging ? "true" : undefined}
				data-card-footer={
					dialLayout === "card" ? CARD_FOOTER_VARIANT : undefined
				}
				className={cn(
					// Hover feedback lives on the cell behind this card (the
					// switcher-style milk container in tokens.css) — the card
					// itself never transforms on hover.
					// `cursor-default` is explicit because the card renders as an
					// <a href>, which the UA stylesheet would otherwise give a
					// hand cursor — kTab uses the platform arrow.
					// The silhouette is the semantic card role (--shape-card), so
					// bookmark cards, folder cards and the drag image share one
					// corner scale instead of three literals.
					"dial-card group relative isolate flex h-full w-full cursor-default select-none flex-col overflow-hidden p-0 transition-[transform,box-shadow,opacity] duration-200 [-webkit-user-drag:element]",
					dialLayout === "card" && ktabShape("card"),
					dialLayout === "card" && "active:scale-[0.97]",
					dialLayout === "icon" && ICON_MODE_SURFACE_CLASS,
					// Screenshot/gradient content is already the bookmark body surface.
					// Keep classic elevation, but avoid a second Liquid Glass backdrop
					// layer behind that visual content. The footer remains materialized
					// independently below.
					dialLayout === "card" && !isLiquid && glassCardMaterial(false),
					glassFocusRing(isLiquid),
					insertion === "before" &&
						dialLayout === "card" &&
						"drop-insert-before",
					insertion === "after" && dialLayout === "card" && "drop-insert-after",
					combineActive && dialLayout === "card" && glassDropRing(isLiquid),
					dragging && "scale-[0.985] opacity-40",
					className,
				)}
			>
				<div>
					{!editing && onSelect && (
						<SelectionCheckbox
							checked={isSelected}
							label={label}
							onSelect={onSelect}
						/>
					)}
					<a
						data-local-context-menu
						className="flex h-full min-h-0 w-full flex-col focus-visible:outline-none"
						href={card.url}
						target={openInNewTab ? "_blank" : "_self"}
						rel={openInNewTab ? "noopener noreferrer" : undefined}
						aria-label={isSelected ? `${label}, selected` : label}
						title={dialLayout === "icon" ? `${label} · ${card.url}` : label}
						onClick={onClick}
						onKeyDown={(e) => {
							// Space toggles selection while selection mode is
							// active (Enter keeps opening the link natively).
							if (e.key === " ") {
								e.preventDefault();
								useSelectionStore.getState().toggle({
									id: card.id,
									kind: "card",
									sourceId: card.folderId,
								});
							}
						}}
						draggable={editing ? false : (dragProps?.draggable ?? true)}
						onDragStart={editing ? undefined : dragProps?.onDragStart}
						onDragEnd={dragProps?.onDragEnd}
						onDragOver={dragProps?.onDragOver}
						onDragLeave={dragProps?.onDragLeave}
						onDrop={dragProps?.onDrop}
					>
						{dialLayout === "icon" ? (
							<IconModeTile
								url={card.url}
								favicon={faviconSrc}
								label={label}
								showLabel={iconShowLabel || editing}
								tileSurface={iconTileSurface}
								labelContent={
									editing ? (
										<InlineRenameInput
											value={savedTitle}
											commitOnSame={
												(card.titleSource ?? defaultTitleSource) !== "saved"
											}
											ariaLabel={`Rename ${label}`}
											onCommit={handleCommitRename}
											onCancel={cancelRename}
											className={cn(
												"icon-label w-full flex-none text-center",
												iconTileSurface && "icon-label-glass",
											)}
										/>
									) : undefined
								}
								tileClassName={cn(
									combineActive && "icon-app-tile-drop-active",
									dragging && "icon-app-tile-dragging",
									insertion === "before" && "icon-drop-insert-before",
									insertion === "after" && "icon-drop-insert-after",
								)}
							/>
						) : (
							<>
								{/* Cover fills the bounded media box without stretching or letterbox
							    bands. The fallback keeps its gradient behind the site's favicon. */}
								<div
									className="thumb squircle relative flex min-h-0 flex-1 items-center justify-center overflow-hidden [--squircle-r:var(--shape-card-fallback,10px)]"
									data-refreshing={refreshCapturing ? "true" : undefined}
									aria-busy={refreshCapturing || decoding || undefined}
									style={{ background: fallbackColor }}
								>
									{/* Retain an opaque decoded base until the replacement has
									    faded in; fading both layers exposes the fallback mid-swap. */}
									{thumbnail?.previous && (
										<img
											src={thumbnail.previous.url}
											alt=""
											data-thumbnail-previous
											className="thumb-media absolute inset-0 size-full object-cover object-center"
											draggable={false}
										/>
									)}
									{/* A local presence boundary isolates replacements from the
									    grid's initial=false, which otherwise skips their fade. */}
									<AnimatePresence initial={false}>
										{thumbnail && (
											<motion.img
												key={thumbnail.id}
												src={thumbnail.url}
												alt=""
												className="thumb-media absolute inset-0 size-full object-cover object-center"
												initial={
													thumbnail.id === initialThumbId.current &&
													!thumbnail.previous
														? false
														: { opacity: 0 }
												}
												animate={{ opacity: 1 }}
												transition={{
													duration: reduceMotion
														? DURATION.instant
														: DURATION.navigation,
													ease: EASE.out,
												}}
												onAnimationComplete={() => {
													setThumbnail((current) =>
														current?.id === thumbnail.id && current.previous
															? { id: current.id, url: current.url }
															: current,
													);
												}}
												draggable={false}
											/>
										)}
									</AnimatePresence>
									{!thumbnail && (
										<>
											{resolvedFavicon.status === "svg" &&
											resolvedFavicon.svgXml ? (
												<SvgIcon
													svgXml={resolvedFavicon.svgXml}
													alt=""
													className="favicon relative z-10 size-10 shrink-0"
												/>
											) : resolvedFavicon.status === "image" &&
												resolvedFavicon.imageSrc ? (
												<img
													src={resolvedFavicon.imageSrc}
													alt=""
													draggable={false}
													className="favicon size-10 shrink-0 rounded-full object-contain"
												/>
											) : resolvedFavicon.status === "letter" ? (
												<span
													aria-hidden="true"
													className="icon-letter-mark favicon relative z-10 flex size-10 shrink-0 items-center justify-center"
												>
													{deriveInitialLetter(card.url)}
												</span>
											) : (
												<img
													src={faviconSrc}
													alt=""
													draggable={false}
													className="favicon size-10 shrink-0 rounded-full object-contain"
													onError={(e) => {
														(e.target as HTMLImageElement).onerror = null;
														(e.target as HTMLImageElement).src = faviconUrl(
															card.url,
														);
													}}
												/>
											)}
										</>
									)}
									<ThumbnailFeedback
										active={refreshCapturing}
										hasPreview={thumbnail !== null || Boolean(card.thumbId)}
									/>
								</div>

								{(showTitle || editing) && (
									<div
										className={cn(
											// Same squircle system as the outer card so the
											// footer follows the card geometry in every
											// browser (corner-shape aware or fallback).
											"card-footer squircle flex shrink-0 items-center justify-start gap-1.5 rounded-b-[var(--shape-card,18px)] px-2.5 text-left [--squircle-r:var(--shape-card-fallback,10px)]",
											cardFooterMaterial(isLiquid),
										)}
										style={
											CARD_FOOTER_VARIANT === "glass"
												? { height: "var(--card-footer-h, 30px)" }
												: undefined
										}
									>
										{resolvedFavicon.status === "svg" &&
										resolvedFavicon.svgXml ? (
											<SvgIcon
												svgXml={resolvedFavicon.svgXml}
												alt=""
												className="favicon relative z-10 h-4 w-4 shrink-0"
											/>
										) : (
											<img
												src={
													resolvedFavicon.status === "image" &&
													resolvedFavicon.imageSrc
														? resolvedFavicon.imageSrc
														: faviconSrc
												}
												alt=""
												draggable={false}
												className="favicon h-4 w-4 shrink-0 rounded-full"
												onError={(e) => {
													(e.target as HTMLImageElement).onerror = null;
													(e.target as HTMLImageElement).src = faviconUrl(
														card.url,
													);
												}}
											/>
										)}
										{editing ? (
											<InlineRenameInput
												value={savedTitle}
												commitOnSame={
													(card.titleSource ?? defaultTitleSource) !== "saved"
												}
												ariaLabel={`Rename ${label}`}
												onCommit={handleCommitRename}
												onCancel={cancelRename}
											/>
										) : (
											<span className="title truncate font-medium text-[11px]">
												{label}
											</span>
										)}
									</div>
								)}
							</>
						)}
					</a>
				</div>
			</ContextMenuTrigger>

			<ContextMenuContent className={glassMenu(isLiquid, resolvedDark)}>
				<ContextMenuItem
					className={glassDropdownItem(isLiquid, resolvedDark, {
						pillOwned: true,
					})}
					onSelect={handleOpenNewTab}
				>
					<Icon name="globe" size={14} />
					Open in new tab
				</ContextMenuItem>
				<ContextMenuItem
					className={glassDropdownItem(isLiquid, resolvedDark, {
						pillOwned: true,
					})}
					onSelect={() => beginRename({ kind: "card", id: card.id })}
				>
					<Icon name="pencil" size={14} />
					Rename
				</ContextMenuItem>
				<ContextMenuItem
					className={glassDropdownItem(isLiquid, resolvedDark, {
						pillOwned: true,
					})}
					onSelect={() =>
						useSelectionStore
							.getState()
							.toggle({ id: card.id, kind: "card", sourceId: card.folderId })
					}
				>
					<Icon name="check-square" size={14} />
					Select
				</ContextMenuItem>
				<ContextMenuItem
					className={glassDropdownItem(isLiquid, resolvedDark, {
						pillOwned: true,
					})}
					onSelect={() => {
						const selected = useSelectionStore.getState().selectedIds;
						openMoveDialog(selected.includes(card.id) ? selected : [card.id]);
					}}
				>
					<Icon name="folder" size={14} />
					Move to…
				</ContextMenuItem>
				{dialLayout === "card" && (
					<ContextMenuItem
						className={glassDropdownItem(isLiquid, resolvedDark, {
							pillOwned: true,
						})}
						onSelect={handleRefreshCard}
					>
						<Icon name="refresh" size={14} />
						{refreshCount > 1
							? REFRESH_STRINGS.batchAction(refreshCount)
							: REFRESH_STRINGS.singleItem}
					</ContextMenuItem>
				)}
				<ContextMenuSeparator />
				<ContextMenuItem
					className={glassDropdownItem(isLiquid, resolvedDark, {
						pillOwned: true,
					})}
					tone="destructive"
					onSelect={() => onDelete(card.id)}
				>
					<Icon name="trash" size={14} />
					Delete
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
