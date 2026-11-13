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

		function askPage(
			type:
				| "snapshot-request"
				| "control-request"
				| "output-request"
				| "output-list-request",
			action?: string,
			deviceId?: string,
		): Promise<unknown> {
			const id = `${Date.now()}-${requestId++}`;
			return new Promise((resolve) => {
				const timeout = window.setTimeout(
					() => {
						pending.delete(id);
						resolve(null);
					},
					type === "output-request" || type === "output-list-request"
						? 8_000
						: 1200,
				);
				pending.set(id, (value) => {
					window.clearTimeout(timeout);
					resolve(value);
				});
				window.postMessage(
					{ channel: CHANNEL, from: "extension", type, id, action, deviceId },
					location.origin,
				);
			});
		}

		window.addEventListener("message", (event: MessageEvent) => {
			if (
				event.source !== window ||
				!isMessage(event.data) ||
				event.data.channel !== CHANNEL ||
				event.data.from !== "main"
			) {
				return;
			}
			if (event.data.type === "update" && isMessage(event.data.snapshot)) {
				void ext.runtime
					.sendMessage({
						type: "ktab:media:update",
						snapshot: event.data.snapshot,
					})
					.catch(() => undefined);
				return;
			}
			if (typeof event.data.id !== "string") return;
			const resolve = pending.get(event.data.id);
			if (!resolve) return;
			pending.delete(event.data.id);
			if (event.data.type === "snapshot-response") {
				resolve(event.data.snapshot ?? null);
			} else if (event.data.type === "control-response") {
				resolve(event.data.ok === true);
			} else if (event.data.type === "output-response") {
				resolve(event.data.result ?? null);
			} else if (event.data.type === "output-list-response") {
				resolve(event.data.result ?? null);
			}
		});

		ext.runtime.onMessage.addListener((message) => {
			if (!isMessage(message)) return undefined;
			if (message.type === "ktab:media:snapshot") {
				return askPage("snapshot-request");
			}
			if (
				message.type === "ktab:media:control" &&
				typeof message.action === "string"
			) {
				return askPage("control-request", message.action);
			}
			if (
				message.type === "ktab:media:set-output" &&
				typeof message.deviceId === "string"
			) {
				return askPage("output-request", undefined, message.deviceId);
			}
			if (message.type === "ktab:media:list-outputs") {
				return askPage("output-list-request");
			}
			return undefined;
		});

		void askPage("snapshot-request").then((snapshot) => {
			if (isMessage(snapshot)) {
				void ext.runtime
					.sendMessage({ type: "ktab:media:update", snapshot })
					.catch(() => undefined);
			}
		});
	},
});
