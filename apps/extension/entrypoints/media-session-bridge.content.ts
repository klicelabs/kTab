import { ext } from "../src/lib/extension-api";

const CHANNEL = "ktab-media-session-v1";

function isMessage(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default defineContentScript({
	matches: ["http://*/*", "https://*/*"],
	runAt: "document_idle",
	main() {
		let requestId = 0;
		const pending = new Map<string, (value: unknown) => void>();

		function askPage(type: "snapshot-request" | "control-request", action?: string): Promise<unknown> {
			const id = `${Date.now()}-${requestId++}`;
			return new Promise((resolve) => {
				const timeout = window.setTimeout(() => {
					pending.delete(id);
					resolve(null);
				}, 1200);
				pending.set(id, (value) => {
					window.clearTimeout(timeout);
					resolve(value);
				});
				window.postMessage({ channel: CHANNEL, from: "extension", type, id, action }, location.origin);
			});
		}

		window.addEventListener("message", (event: MessageEvent) => {
			if (event.source !== window || !isMessage(event.data) || event.data.channel !== CHANNEL || event.data.from !== "main") return;
			if (event.data.type === "update" && isMessage(event.data.snapshot)) {
				void ext.runtime.sendMessage({
					type: "ktab:media:update",
					snapshot: event.data.snapshot,
				}).catch(() => undefined);
				return;
			}
			if (typeof event.data.id !== "string") return;
			const resolve = pending.get(event.data.id);
			if (!resolve) return;
			pending.delete(event.data.id);
			if (event.data.type === "snapshot-response") resolve(event.data.snapshot ?? null);
			else if (event.data.type === "control-response") resolve(event.data.ok === true);
		});

		ext.runtime.onMessage.addListener((message) => {
			if (!isMessage(message)) return undefined;
			if (message.type === "ktab:media:snapshot") {
				return askPage("snapshot-request");
			}
			if (message.type === "ktab:media:control" && typeof message.action === "string") {
				return askPage("control-request", message.action);
			}
			return undefined;
		});
		void askPage("snapshot-request").then((snapshot) => {
			if (isMessage(snapshot)) {
				void ext.runtime.sendMessage({ type: "ktab:media:update", snapshot }).catch(() => undefined);
			}
		});
	},
});
