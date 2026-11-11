import { ext } from "./extension-api";

export interface SwitcherTab {
	id: number;
	windowId: number;
	title: string;
	url: string;
	favIconUrl?: string;
	active: boolean;
	preview?: string;
}

export interface SwitcherPayload {
	tabs: SwitcherTab[];
	activeTabId: number;
	windowId: number;
}

export function orderTabsByRecency(
	tabs: SwitcherTab[],
	recentIds: number[],
): SwitcherTab[] {
	const rank = new Map(recentIds.map((id, index) => [id, index]));
	return [...tabs].sort((a, b) => {
		const aRank = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
		const bRank = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
		return aRank - bRank || Number(b.active) - Number(a.active);
	});
}

const styles = `
:host{all:initial;color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
.veil{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:rgba(7,10,17,.42);backdrop-filter:blur(13px) saturate(.76);-webkit-backdrop-filter:blur(13px) saturate(.76);animation:veil-in .18s ease-out both}
.panel{width:min(1080px,100%);max-height:min(720px,calc(100vh - 48px));overflow:auto;border:1px solid rgba(255,255,255,.16);border-radius:22px;background:linear-gradient(145deg,rgba(31,37,50,.96),rgba(19,23,33,.97));box-shadow:0 30px 100px rgba(0,0,0,.5),0 2px 10px rgba(0,0,0,.22);color:#f5f6fa;padding:24px;animation:panel-in .2s cubic-bezier(.16,1,.3,1) both}
.head{display:flex;align-items:center;gap:14px;margin:0 2px 19px}.heading{min-width:0;flex:1}.title{font-size:18px;line-height:1.3;font-weight:650;letter-spacing:-.025em}.subtitle{margin-top:4px;color:#b3bac9;font-size:12px}.count{font-size:11px;color:#bdc5d5;padding:6px 9px;border:1px solid rgba(255,255,255,.12);border-radius:99px;background:rgba(255,255,255,.05)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:13px;max-height:calc(100vh - 220px);overflow:auto;padding:2px 3px 7px;scrollbar-color:rgba(255,255,255,.25) transparent;scrollbar-width:thin}
.card{min-width:0;position:relative;border:1px solid rgba(255,255,255,.11);border-radius:13px;padding:7px;background:rgba(255,255,255,.045);color:inherit;text-align:left;cursor:pointer;transition:transform .16s ease,border-color .16s ease,background .16s ease,box-shadow .16s ease}.card:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.32);background:rgba(255,255,255,.08)}.card[aria-selected=true]{border-color:#a7b8ff;background:rgba(107,131,255,.14);box-shadow:0 0 0 2px rgba(130,153,255,.42),0 8px 24px rgba(23,36,90,.24)}
.preview{height:132px;display:grid;place-items:center;overflow:hidden;border-radius:8px;background:linear-gradient(145deg,#343d50,#242a37);color:#c8d0df}.preview img{width:100%;height:100%;object-fit:cover}.preview .fallback{font-size:34px;font-weight:650;opacity:.85}.meta{display:flex;align-items:center;gap:8px;padding:9px 3px 3px;min-width:0}.favicon{width:17px;height:17px;flex:none;object-fit:contain;border-radius:3px}.tabtitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:560}.current{margin-left:auto;flex:none;font-size:10px;color:#c6d1ff;background:rgba(129,150,255,.18);border-radius:99px;padding:3px 6px}
.foot{display:flex;align-items:center;gap:14px;padding:16px 3px 0;color:#b7becc;font-size:11px}.keys{display:flex;align-items:center;gap:5px}.key{padding:3px 6px;border:1px solid rgba(255,255,255,.17);border-radius:5px;color:#e0e4ed;background:rgba(255,255,255,.055);font-size:10px}.change{margin-left:auto;border:0;background:none;color:#c5ceff;font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:3px}.empty{padding:48px;text-align:center;color:#c5ccda}
button:focus-visible{outline:2px solid #b3c1ff;outline-offset:2px}
@keyframes veil-in{from{opacity:0}to{opacity:1}}@keyframes panel-in{from{opacity:0;transform:translateY(8px) scale(.99)}to{opacity:1;transform:translateY(0) scale(1)}}
@media(max-width:600px){.veil{padding:12px}.panel{padding:16px;border-radius:17px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.preview{height:92px}.foot{gap:7px;flex-wrap:wrap}.change{margin-left:auto}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
`;

export function mountTabSwitcher(
	payload: SwitcherPayload,
	onActivate: (tabId: number, windowId: number) => void,
	onChangeShortcut: () => void,
	onDismiss: () => void = () => {},
): () => void {
	document.getElementById("klice-tab-switcher")?.remove();
	const host = document.createElement("div");
	host.id = "klice-tab-switcher";
	const shadow = host.attachShadow({ mode: "closed" });
	const style = document.createElement("style");
	style.textContent = styles;
	const veil = document.createElement("div");
	veil.className = "veil";
	veil.setAttribute("role", "presentation");
	const panel = document.createElement("section");
	panel.className = "panel";
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-modal", "true");
	panel.setAttribute("aria-labelledby", "switcher-title");
	panel.innerHTML = `<header class="head"><div class="heading"><div class="title" id="switcher-title">Switch tabs</div><div class="subtitle">Choose a window to continue where you left off</div></div><span class="count">${payload.tabs.length} tabs</span></header>`;
	const grid = document.createElement("div");
	grid.className = "grid";
	grid.setAttribute("role", "listbox");
	grid.setAttribute("aria-label", "Open tabs");
	let selected = Math.max(
		0,
		payload.tabs.findIndex((tab) => tab.id !== payload.activeTabId),
	);
	const buttons: HTMLButtonElement[] = [];
	let cleanup = () => {};
	for (const [index, tab] of payload.tabs.entries()) {
		const card = document.createElement("button");
		card.type = "button";
		card.className = "card";
		card.setAttribute("role", "option");
		card.setAttribute("aria-selected", String(index === selected));
		const preview = document.createElement("div");
		preview.className = "preview";
		if (tab.preview) {
			const img = document.createElement("img");
			img.src = tab.preview;
			img.alt = "";
			preview.append(img);
		} else {
			const fallback = document.createElement("span");
			fallback.className = "fallback";
			fallback.textContent =
				(tab.title || tab.url || "?").trim().charAt(0).toUpperCase() || "?";
			preview.append(fallback);
		}
		const meta = document.createElement("div");
		meta.className = "meta";
		if (tab.favIconUrl) {
			const icon = document.createElement("img");
			icon.className = "favicon";
			icon.src = tab.favIconUrl;
			icon.alt = "";
			meta.append(icon);
		}
		const title = document.createElement("span");
		title.className = "tabtitle";
		title.textContent = tab.title || tab.url || "Untitled tab";
		meta.append(title);
		if (tab.active) {
			const badge = document.createElement("span");
			badge.className = "current";
			badge.textContent = "Current";
			meta.append(badge);
		}
		card.append(preview, meta);
		card.addEventListener("click", () => {
			cleanup();
			onActivate(tab.id, tab.windowId);
		});
		buttons.push(card);
		grid.append(card);
	}
	if (!payload.tabs.length) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = "No open tabs found.";
		grid.append(empty);
	}
	const footer = document.createElement("footer");
	footer.className = "foot";
	footer.innerHTML = `<div class="keys"><span class="key">↑</span><span class="key">↓</span><span>Navigate</span></div><div class="keys"><span class="key">↵</span><span>Switch</span></div><div class="keys"><span class="key">Esc</span><span>Close</span></div>`;
	const change = document.createElement("button");
	change.className = "change";
	change.textContent = "Change shortcut";
	change.type = "button";
	change.addEventListener("click", onChangeShortcut);
	footer.append(change);
	panel.append(grid, footer);
	veil.append(panel);
	shadow.append(style, veil);
	document.documentElement.append(host);
	const updateSelection = (next: number) => {
		if (!buttons.length) return;
		selected = (next + buttons.length) % buttons.length;
		buttons.forEach((button, index) => {
			button.setAttribute("aria-selected", String(index === selected));
		});
		buttons[selected].focus();
		buttons[selected].scrollIntoView({ block: "nearest", inline: "nearest" });
	};
	const keydown = (event: KeyboardEvent) => {
		if (event.key === "Tab") {
			const focusable = [...buttons, change];
			const current = focusable.indexOf(
				shadow.activeElement as HTMLButtonElement,
			);
			const next = event.shiftKey
				? current <= 0
					? focusable.length - 1
					: current - 1
				: current === -1 || current === focusable.length - 1
					? 0
					: current + 1;
			event.preventDefault();
			focusable[next]?.focus();
		} else if (event.key === "Escape") {
			event.preventDefault();
			cleanup();
		} else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
			event.preventDefault();
			updateSelection(selected + 1);
		} else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
			event.preventDefault();
			updateSelection(selected - 1);
		} else if (event.key === "Enter" && buttons.length) {
			event.preventDefault();
			const tab = payload.tabs[selected];
			cleanup();
			onActivate(tab.id, tab.windowId);
		}
	};
	const backdrop = (event: MouseEvent) => {
		if (event.target === veil) cleanup();
	};
	let cleanedUp = false;
	cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		document.removeEventListener("keydown", keydown, true);
		veil.removeEventListener("click", backdrop);
		host.remove();
		onDismiss();
	};
	document.addEventListener("keydown", keydown, true);
	veil.addEventListener("click", backdrop);
	buttons[selected]?.focus();
	return cleanup;
}

export function installTabSwitcherReceiver(): void {
	let cleanupCurrent: () => void = () => {};
	ext.runtime.onMessage.addListener((message) => {
		const request = message as {
			type?: string;
			payload?: SwitcherPayload;
		} | null;
		if (
			!request?.payload ||
			!["tab-switcher:open", "tab-switcher:update"].includes(request.type ?? "")
		)
			return;
		const dismiss = () => {
			void ext.runtime.sendMessage({ type: "tab-switcher:closed" });
		};
		cleanupCurrent();
		cleanupCurrent = mountTabSwitcher(
			request.payload,
			(tabId, windowId) => {
				void ext.runtime.sendMessage({
					type: "tab-switcher:activate",
					tabId,
					windowId,
				});
			},
			() => {
				void ext.runtime.sendMessage({ type: "tab-switcher:shortcuts" });
			},
			dismiss,
		);
		void ext.runtime.sendMessage({
			type: "tab-switcher:opened",
			windowId: request.payload.windowId,
			activeTabId: request.payload.activeTabId,
		});
	});
}
