import type { DragEvent } from "react";

const GHOST_ATTR = "data-ktab-drag-ghost";

/** Remove leaked ghost nodes (a cancelled gesture can skip dragend). */
export function sweepDragGhosts(): void {
	if (typeof document === "undefined") return;
	for (const node of document.querySelectorAll(`[${GHOST_ATTR}]`)) {
		node.remove();
	}
}

function trackGhost(ghost: HTMLElement): void {
	ghost.setAttribute(GHOST_ATTR, "true");
	const remove = () => ghost.remove();
	// drop precedes dragend in practice, but a browser-cancelled gesture
	// (window blur, Escape races) can skip dragend and leak the node.
	window.addEventListener("dragend", remove, { once: true });
	window.addEventListener("drop", remove, { once: true });
	window.addEventListener("blur", remove, { once: true });
}

/**
 * Premium group drag overlay for multi-item transport.
 *
 * Never duplicates every card under the pointer: one restrained lift — two
 * offset miniature tiles plus a count badge — visually related to the
 * Selection Tray so both halves of the transport system read as one.
 *
 * The ghost lives offscreen in the document (same document, so it renders in
 * the native drag image) and removes itself at the terminal gesture boundary
 * (drop, dragend, or window blur). Call synchronously inside dragstart:
 * browsers ignore setDragImage after return.
 */
export function showGroupDragGhost(e: DragEvent, total: number): void {
	if (typeof document === "undefined") return;
	if (!Number.isFinite(total) || total < 1) return;
	sweepDragGhosts();

	if (total === 1) {
		const ghost = document.createElement("div");
		ghost.setAttribute("aria-hidden", "true");
		ghost.style.cssText = [
			"position:fixed",
			"left:-1000px",
			"top:-1000px",
			"width:48px",
			"height:48px",
			"pointer-events:none",
			"margin:0",
			"padding:0",
		].join(";");

		const front = document.createElement("div");
		front.style.cssText = [
			"display:flex",
			"position:absolute",
			"inset:4px",
			"align-items:center",
			"justify-content:center",
			"overflow:hidden",
			"border-radius:14px",
			"background:linear-gradient(145deg,#f8f9fc 0%,#dfe4ec 100%)",
			"box-shadow:0 10px 22px rgba(0,0,0,0.28)",
		].join(";");

		const sourceTile =
			e.currentTarget instanceof HTMLElement
				? e.currentTarget.querySelector<HTMLElement>(".icon-app-tile")
				: null;
		if (sourceTile) {
			front.style.background = getComputedStyle(sourceTile).background;
			const sourceImage = sourceTile.querySelector<HTMLImageElement>("img");
			if (sourceImage?.src) {
				const image = document.createElement("img");
				image.src = sourceImage.src;
				image.alt = "";
				image.draggable = false;
				image.style.cssText = "width:62%;height:62%;object-fit:contain";
				front.appendChild(image);
			}
		}

		ghost.appendChild(front);
		document.body.appendChild(ghost);
		try {
			e.dataTransfer.setDragImage(ghost, 24, 24);
		} catch {
			ghost.remove();
			return;
		}
		trackGhost(ghost);
		return;
	}

	const ghost = document.createElement("div");
	ghost.setAttribute("aria-hidden", "true");
	ghost.style.cssText = [
		"position:fixed",
		"left:-1000px",
		"top:-1000px",
		"width:52px",
		"height:44px",
		"pointer-events:none",
		"margin:0",
		"padding:0",
	].join(";");

	const back = document.createElement("div");
	back.style.cssText = [
		"position:absolute",
		"left:8px",
		"top:0",
		"width:32px",
		"height:32px",
		"border-radius:9px",
		"background:rgba(60,60,64,0.92)",
		"border:1px solid rgba(255,255,255,0.22)",
		"transform:rotate(-7deg)",
	].join(";");

	const front = document.createElement("div");
	front.style.cssText = [
		"position:absolute",
		"left:2px",
		"top:5px",
		"width:32px",
		"height:32px",
		"border-radius:9px",
		"background:rgba(38,38,42,0.96)",
		"border:1px solid rgba(255,255,255,0.28)",
		"box-shadow:0 8px 20px rgba(0,0,0,0.4)",
		"transform:rotate(4deg)",
	].join(";");

	const badge = document.createElement("div");
	badge.textContent = total > 99 ? "99+" : String(total);
	badge.style.cssText = [
		"position:absolute",
		"right:-2px",
		"bottom:-2px",
		"min-width:20px",
		"height:20px",
		"padding:0 5px",
		"border-radius:999px",
		"background:#0a84ff",
		"color:#fff",
		"font:600 11px/20px -apple-system,BlinkMacSystemFont,sans-serif",
		"text-align:center",
	].join(";");

	ghost.append(back, front, badge);
	document.body.appendChild(ghost);

	try {
		e.dataTransfer.setDragImage(ghost, 26, 22);
	} catch {
		ghost.remove();
		return;
	}

	trackGhost(ghost);
}
