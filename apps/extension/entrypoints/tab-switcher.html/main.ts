import { ext } from "../../src/lib/extension-api";
import {
	mountTabSwitcher,
	type SwitcherPayload,
} from "../../src/lib/tab-switcher";

const params = new URLSearchParams(location.search);
const windowId = Number(params.get("windowId"));
const activeTabId = Number(params.get("activeTabId"));
let cleanupCurrent: () => void = () => {};

function showSwitcher(payload: SwitcherPayload): void {
	cleanupCurrent();
	cleanupCurrent = mountTabSwitcher(
		payload,
		(tabId, targetWindowId) => {
			void ext.runtime
				.sendMessage({
					type: "tab-switcher:activate",
					tabId,
					windowId: targetWindowId,
				})
				.then(
					() => window.close(),
					() => window.close(),
				);
		},
		() => {
			void ext.runtime.sendMessage({ type: "tab-switcher:shortcuts" });
		},
		() => {
			void ext.runtime.sendMessage({ type: "tab-switcher:closed" });
		},
	);
	void ext.runtime.sendMessage({
		type: "tab-switcher:opened",
		windowId: payload.windowId,
		activeTabId: payload.activeTabId,
	});
}

ext.runtime.onMessage.addListener((message) => {
	const update = message as { type?: string; payload?: SwitcherPayload } | null;
	if (update?.type === "tab-switcher:update" && update.payload) {
		showSwitcher(update.payload);
	}
});

void ext.runtime
	.sendMessage({ type: "tab-switcher:get-tabs", windowId, tabId: activeTabId })
	.then((response) => {
		const payload = (response as { payload?: SwitcherPayload } | undefined)
			?.payload;
		if (!payload) {
			document.body.textContent = "Unable to load open tabs.";
			return;
		}
		showSwitcher(payload);
	})
	.catch(() => {
		document.body.textContent = "Unable to load open tabs.";
	});
