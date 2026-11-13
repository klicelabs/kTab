import {
	listAudioOutputDevices,
	setMediaOutputForElement,
} from "../src/lib/media-output";

export default defineContentScript({
	matches: ["http://*/*", "https://*/*"],
	runAt: "document_idle",
	world: "MAIN",
	main() {
		const win = window as typeof window & {
			__ktabMediaSessionInstalled?: boolean;
		};
		if (win.__ktabMediaSessionInstalled) return;
		win.__ktabMediaSessionInstalled = true;
		const channel = "ktab-media-session-v1";
		const mediaElements = new Set<HTMLMediaElement>();
		let previousSignature = "";
		let lastTimeUpdate = 0;

		function getMediaElement(): HTMLMediaElement | null {
			for (const media of mediaElements) {
				if (!media.paused && !media.ended) return media;
			}
			for (const media of mediaElements) {
				if (media.currentSrc || Number.isFinite(media.duration)) return media;
			}
			return null;
		}

		function playerButtons(action: "next" | "previous"): Element[] {
			const selectors =
				action === "next"
					? [
							"#movie_player .ytp-next-button",
							"button[data-testid='control-button-skip-forward']",
							"button[aria-label*='next track' i]",
							"button[aria-label*='next song' i]",
							"button[title*='next track' i]",
							"button[aria-label='Next' i]",
						]
					: [
							"#movie_player .ytp-prev-button",
							"button[data-testid='control-button-skip-back']",
							"button[aria-label*='previous track' i]",
							"button[aria-label*='previous song' i]",
							"button[title*='previous track' i]",
							"button[aria-label='Previous' i]",
						];
			return selectors.flatMap((selector) =>
				Array.from(document.querySelectorAll(selector)),
			);
		}

		function getSnapshot() {
			const media = getMediaElement();
			const session =
				"mediaSession" in navigator ? navigator.mediaSession : null;
			const metadata = session?.metadata ?? null;
			const metaArtwork = metadata?.artwork?.slice().sort((a, b) => {
				const size = (value: string) => Number.parseInt(value, 10) || 0;
				return size(b.sizes ?? "0") - size(a.sizes ?? "0");
			})[0]?.src;
			const ogImage = document.querySelector<HTMLMetaElement>(
				"meta[property='og:image']",
			)?.content;
			const artwork = metaArtwork || ogImage || null;
			const playing =
				session?.playbackState === "playing" ||
				Boolean(media && !media.paused && !media.ended);
			const available = Boolean(
				metadata || media?.currentSrc || media?.readyState,
			);
			const title =
				metadata?.title?.trim() || document.title.trim() || "Media playing";
			const artist =
				metadata?.artist?.trim() || location.hostname.replace(/^www\./, "");
			const currentTime =
				media && Number.isFinite(media.currentTime) ? media.currentTime : 0;
			const duration =
				media && Number.isFinite(media.duration) ? media.duration : 0;
			const canNext = playerButtons("next").length > 0;
			const canPrevious = playerButtons("previous").length > 0;
			return {
				available,
				title,
				artist,
				album: metadata?.album?.trim() ?? "",
				artwork,
				playing,
				currentTime,
				duration,
				canNext,
				canPrevious,
			};
		}

		function postSnapshot(force = false) {
			const snapshot = getSnapshot();
			const signature = JSON.stringify({
				available: snapshot.available,
				title: snapshot.title,
				artist: snapshot.artist,
				album: snapshot.album,
				artwork: snapshot.artwork,
				playing: snapshot.playing,
				canNext: snapshot.canNext,
				canPrevious: snapshot.canPrevious,
			});
			if (!force && signature === previousSignature) return;
			previousSignature = signature;
			window.postMessage(
				{ channel, from: "main", type: "update", snapshot },
				location.origin,
			);
		}

		function attachMedia(media: HTMLMediaElement) {
			if (mediaElements.has(media)) return;
			mediaElements.add(media);
			for (const eventName of [
				"play",
				"pause",
				"ended",
				"loadedmetadata",
				"durationchange",
			]) {
				media.addEventListener(eventName, () => postSnapshot(true));
			}
			media.addEventListener("timeupdate", () => {
				const now = Date.now();
				if (now - lastTimeUpdate < 4000) return;
				lastTimeUpdate = now;
				postSnapshot();
			});
		}

		function attachTree(node: Node) {
			if (node instanceof HTMLMediaElement) attachMedia(node);
			if (node instanceof Element) {
				for (const media of node.querySelectorAll("audio,video")) {
					if (media instanceof HTMLMediaElement) attachMedia(media);
				}
			}
		}

		for (const media of document.querySelectorAll("audio,video")) {
			if (media instanceof HTMLMediaElement) attachMedia(media);
		}
		new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) attachTree(node);
			}
			postSnapshot();
		}).observe(document.documentElement, { childList: true, subtree: true });

		window.addEventListener("message", (event: MessageEvent) => {
			if (
				event.source !== window ||
				!event.data ||
				event.data.channel !== channel ||
				event.data.from !== "extension"
			)
				return;
			if (event.data.type === "snapshot-request") {
				window.postMessage(
					{
						channel,
						from: "main",
						type: "snapshot-response",
						id: event.data.id,
						snapshot: getSnapshot(),
					},
					location.origin,
				);
				return;
			}
			if (event.data.type === "output-list-request") {
				const id = typeof event.data.id === "string" ? event.data.id : "";
				if (!id) return;
				void listAudioOutputDevices(navigator.mediaDevices ?? null).then(
					(result) => {
						window.postMessage(
							{
								channel,
								from: "main",
								type: "output-list-response",
								id,
								result,
							},
							location.origin,
						);
					},
				);
				return;
			}
			if (event.data.type === "output-request") {
				const id = typeof event.data.id === "string" ? event.data.id : "";
				const deviceId =
					typeof event.data.deviceId === "string" ? event.data.deviceId : null;
				const media = getMediaElement() as
					| (HTMLMediaElement & {
							setSinkId?: (sinkId: string) => Promise<void>;
					  })
					| null;
				const respond = (result: { ok: boolean; reason?: string }) => {
					window.postMessage(
						{ channel, from: "main", type: "output-response", id, result },
						location.origin,
					);
				};
				if (!id || deviceId === null) return;
				void setMediaOutputForElement(media, deviceId).then(respond);
				return;
			}
			if (event.data.type !== "control-request") return;
			const action = event.data.action;
			const media = getMediaElement();
			let ok = false;
			if (action === "play" || action === "pause") {
				if (media) {
					if (action === "play")
						void media
							.play()
							.then(() => postSnapshot(true))
							.catch(() => undefined);
					else media.pause();
					ok = true;
				} else {
					const selector =
						action === "play"
							? "button[aria-label*='play' i]"
							: "button[aria-label*='pause' i]";
					const button = document.querySelector<HTMLElement>(selector);
					button?.click();
					ok = Boolean(button);
				}
			} else if (action === "next" || action === "previous") {
				const button = playerButtons(action).find(
					(candidate) => !candidate.hasAttribute("disabled"),
				);
				if (button instanceof HTMLElement) {
					button.click();
					ok = true;
				}
			}
			window.postMessage(
				{
					channel,
					from: "main",
					type: "control-response",
					id: event.data.id,
					ok,
				},
				location.origin,
			);
		});

		postSnapshot(true);
		window.setInterval(() => postSnapshot(), 10_000);
	},
});
