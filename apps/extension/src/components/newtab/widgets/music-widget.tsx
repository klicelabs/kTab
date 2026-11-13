import {
	Popover,
	PopoverDescription,
	PopoverPopup,
	PopoverPortal,
	PopoverPositioner,
	PopoverTitle,
	PopoverTrigger,
} from "@ktab/ui/components/popover";
import { Icon } from "@ktab/ui/icons/icon";
import { useEffect, useMemo, useState } from "react";
import { ext } from "../../../lib/extension-api";
import {
	controlMediaSession,
	enumerateMediaSessionOutputs,
	type MediaAudioOutputDevice,
	type MediaControlAction,
	type MediaOutputResult,
	type MediaSessionSnapshot,
	queryMediaSessions,
	setMediaSessionOutput,
} from "../../../lib/media-session";
import { useSetupStore } from "../../../stores/setup-store";
import type { MusicAppearance, WidgetSizePreference } from "../../../types";
import { WidgetSurface } from "./widget-surface";

function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const total = Math.floor(seconds);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function safeArtworkUrl(value: string | null): string | null {
	if (!value || value.length > 2048) return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" ||
			url.protocol === "http:" ||
			url.protocol === "data:"
			? url.href
			: null;
	} catch {
		return null;
	}
}

function SoundBars({ playing }: { playing: boolean }) {
	return (
		<span
			className={`music-widget-bars ${playing ? "is-playing" : ""}`}
			aria-hidden="true"
		>
			<span />
			<span />
			<span />
			<span />
		</span>
	);
}

function outputError(result: MediaOutputResult): string {
	if (result.reason === "unsupported") {
		return "This browser does not support per-tab audio output.";
	}
	if (result.reason === "no-media") {
		return "Start playback in this tab before choosing an output.";
	}
	if (result.reason === "blocked") {
		return "This site blocked audio output selection. Check its speaker permissions.";
	}
	return "Could not change this tab’s audio output. Try again.";
}

function AudioOutputPicker({
	activeTabId,
	onSelect,
	onEnumerate,
}: {
	activeTabId: number | null;
	onSelect: (deviceId: string) => Promise<MediaOutputResult>;
	onEnumerate: (tabId: number) => Promise<{
		ok: boolean;
		devices: MediaAudioOutputDevice[];
		reason?: string;
	}>;
}) {
	const [open, setOpen] = useState(false);
	const [devices, setDevices] = useState<MediaAudioOutputDevice[]>([]);
	const [status, setStatus] = useState<
		"idle" | "loading" | "ready" | "error" | "switching"
	>("idle");
	const [message, setMessage] = useState("");

	async function loadDevices() {
		setStatus("loading");
		setMessage("");
		if (activeTabId === null) {
			setDevices([]);
			setStatus("error");
			setMessage("Start playback in a tab before listing its audio outputs.");
			return;
		}
		try {
			const result = await onEnumerate(activeTabId);
			if (!result.ok) {
				setDevices([]);
				setStatus("error");
				setMessage(
					result.reason === "unsupported"
						? "This browser does not support listing outputs in the media tab."
						: "The site did not expose audio outputs. Check its speaker permissions and try again.",
				);
				return;
			}
			setDevices(
				result.devices.map((device, index) => ({
					...device,
					label:
						device.label.trim() ||
						(device.deviceId === "default"
							? "System default"
							: `Audio output ${index + 1}`),
				})),
			);
			setStatus("ready");
			if (result.devices.length === 0) {
				setMessage(
					"This site only exposes audio outputs allowed by its browser permissions.",
				);
			}
		} catch {
			setDevices([]);
			setStatus("error");
			setMessage("Could not list audio outputs for this tab. Try again.");
		}
	}

	function handleOpenChange(nextOpen: boolean) {
		setOpen(nextOpen);
		if (nextOpen) void loadDevices();
	}

	async function chooseDevice(deviceId: string) {
		if (activeTabId === null) {
			setMessage("Start playback in a tab before choosing an output.");
			return;
		}
		setStatus("switching");
		const result = await onSelect(deviceId === "default" ? "" : deviceId);
		setStatus(result.ok ? "ready" : "error");
		setMessage(
			result.ok ? "Audio output updated for this tab." : outputError(result),
		);
	}

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger
				type="button"
				aria-label="Choose audio output for this tab"
				className="grid size-8 place-items-center rounded-full transition-colors duration-150 hover:bg-current/10 focus-visible:outline-2 focus-visible:outline-[var(--ktab-accent)] focus-visible:outline-offset-2"
			>
				<Icon name="headphones" size={18} aria-hidden="true" />
			</PopoverTrigger>
			<PopoverPortal>
				<PopoverPositioner side="top" align="end" sideOffset={8}>
					<PopoverPopup className="w-[264px] rounded-xl bg-background p-3 text-foreground shadow-lg ring-1 ring-border/60">
						<PopoverTitle className="text-[13px]">Audio output</PopoverTitle>
						<PopoverDescription className="mt-1 text-[11px] leading-[1.4]">
							Change output for media playing in this tab only. The site may
							restrict available devices.
						</PopoverDescription>
						{activeTabId === null ? (
							<p className="mt-3 text-[11px] text-muted-foreground">
								Start playback in a tab before choosing a device.
							</p>
						) : null}
						{devices.length > 0 ? (
							<ul className="mt-2 grid max-h-40 gap-1 overflow-y-auto">
								{devices.map((device) => (
									<li key={`${device.deviceId}:${device.label}`}>
										<button
											type="button"
											disabled={activeTabId === null || status === "switching"}
											onClick={() => void chooseDevice(device.deviceId)}
											className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-foreground hover:bg-muted disabled:opacity-50"
										>
											<Icon
												name="headphones"
												size={14}
												className="shrink-0 opacity-65"
												aria-hidden="true"
											/>
											<span className="truncate">{device.label}</span>
										</button>
									</li>
								))}
							</ul>
						) : null}
						{status === "loading" ? (
							<p className="mt-3 text-[11px] text-muted-foreground">
								Finding audio outputs…
							</p>
						) : null}
						<p
							role="status"
							aria-live="polite"
							className="mt-2 min-h-4 text-[11px] text-muted-foreground leading-[1.4]"
						>
							{message ||
								(status === "switching"
									? "Changing this tab’s audio output…"
									: "")}
						</p>
					</PopoverPopup>
				</PopoverPositioner>
			</PopoverPortal>
		</Popover>
	);
}

export function MusicWidget() {
	const settings = useSetupStore((state) => state.settings.widgets.music);
	const [session, setSession] = useState<MediaSessionSnapshot | null>(null);
	const [busyAction, setBusyAction] = useState<MediaControlAction | null>(null);
	const sessionTabId = session?.tabId;

	useEffect(() => {
		if (!settings.enabled) return;
		let active = true;
		const update = async () => {
			const sessions = await queryMediaSessions(sessionTabId);
			if (active) setSession(sessions[0] ?? null);
		};
		const handleTabUpdated = (
			_tabId: number,
			changeInfo: { audible?: boolean; title?: string; favIconUrl?: string },
		) => {
			if (
				changeInfo.audible !== undefined ||
				changeInfo.title !== undefined ||
				changeInfo.favIconUrl !== undefined
			) {
				void update();
			}
		};
		const handleTabActivated = () => void update();
		const handleTabRemoved = () => void update();

		void update();
		ext.tabs.onUpdated.addListener(handleTabUpdated);
		ext.tabs.onActivated.addListener(handleTabActivated);
		ext.tabs.onRemoved.addListener(handleTabRemoved);
		return () => {
			active = false;
			ext.tabs.onUpdated.removeListener(handleTabUpdated);
			ext.tabs.onActivated.removeListener(handleTabActivated);
			ext.tabs.onRemoved.removeListener(handleTabRemoved);
		};
	}, [sessionTabId, settings.enabled]);

	if (!settings.enabled) return null;

	async function control(action: MediaControlAction) {
		if (!session || busyAction) return;
		setBusyAction(action);
		await controlMediaSession(session.tabId, action);
		const sessions = await queryMediaSessions(session.tabId);
		setSession(sessions[0] ?? null);
		setBusyAction(null);
	}
	return (
		<MusicWidgetView
			appearance={settings.appearance}
			size={settings.size}
			session={session}
			busyAction={busyAction}
			onControl={control}
			onSetOutput={(deviceId) =>
				session
					? setMediaSessionOutput(session.tabId, deviceId)
					: Promise.resolve({ ok: false, reason: "no-media" })
			}
		/>
	);
}

export function MusicWidgetView({
	appearance,
	size = "expanded",
	session,
	busyAction,
	onControl,
	onSetOutput,
}: {
	appearance: MusicAppearance;
	size?: WidgetSizePreference;
	session: MediaSessionSnapshot | null;
	busyAction: MediaControlAction | null;
	onControl: (action: MediaControlAction) => void | Promise<void>;
	onSetOutput?: (deviceId: string) => Promise<MediaOutputResult>;
}) {
	const artwork = useMemo(
		() => safeArtworkUrl(session?.artwork ?? null),
		[session?.artwork],
	);
	const duration = session?.duration ?? 0;
	const currentTime = session?.currentTime ?? 0;
	const progress =
		duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
	const hasProgress = duration > 0;
	const playing = session?.playing === true;
	const compact = size === "compact";

	return (
		<WidgetSurface
			name="music"
			size={size}
			appearance={appearance}
			className="relative p-3"
		>
			{appearance === "album-blur" && artwork ? (
				<>
					<img
						aria-hidden="true"
						alt=""
						src={artwork}
						referrerPolicy="no-referrer"
						className="pointer-events-none absolute inset-0 z-0 size-full scale-125 object-cover blur-2xl"
					/>
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 z-[1] bg-black/45"
					/>
				</>
			) : null}
			<div className="relative z-10 flex h-full min-h-0 flex-col justify-between gap-2">
				<div className="flex min-w-0 items-center gap-3">
					<div
						className={`squircle grid shrink-0 place-items-center overflow-hidden rounded-[var(--shape-thumb,12px)] bg-neutral-900/10 ring-1 ring-current/10 [--squircle-r:var(--shape-thumb-fallback,7px)] ${compact ? "size-[56px]" : "size-[64px]"}`}
					>
						{artwork ? (
							<img
								src={artwork}
								alt=""
								referrerPolicy="no-referrer"
								loading="lazy"
								className="size-full object-cover"
								onError={(event) => {
									event.currentTarget.style.display = "none";
								}}
							/>
						) : (
							<Icon
								name="music"
								size={25}
								className="dashboard-widget-muted"
								aria-hidden="true"
							/>
						)}
					</div>
					<div className="min-w-0 flex-1">
						<p className="truncate font-semibold text-[14px] leading-[1.25]">
							{session?.title ?? "Nothing playing"}
						</p>
						<p className="dashboard-widget-muted mt-0.5 truncate text-[13px] leading-[1.25]">
							{session?.artist ?? "Start audio in any browser tab"}
						</p>
					</div>
					{compact ? (
						<button
							type="button"
							aria-label={playing ? "Pause" : "Play"}
							disabled={!session || busyAction !== null}
							onClick={() => void onControl(playing ? "pause" : "play")}
							className="grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-150 hover:bg-current/10 disabled:opacity-35"
						>
							<Icon
								name={playing ? "pause" : "play"}
								size={22}
								fill="currentColor"
								aria-hidden="true"
							/>
						</button>
					) : (
						<div className="dashboard-widget-muted grid size-8 shrink-0 place-items-center">
							<SoundBars playing={playing} />
						</div>
					)}
				</div>

				{compact ? (
					<div className="dashboard-widget-muted flex min-w-0 items-center justify-between gap-2 text-[10px] tabular-nums">
						<span className="truncate">
							{session?.album || session?.artist || "Ready when you are"}
						</span>
						{hasProgress ? (
							<span className="shrink-0">{formatTime(currentTime)}</span>
						) : null}
					</div>
				) : (
					<>
						{hasProgress ? (
							<div className="dashboard-widget-muted grid grid-cols-[34px_1fr_40px] items-center gap-2 text-[10px] tabular-nums">
								<span>{formatTime(currentTime)}</span>
								<div
									className="dashboard-widget-track h-[4px] overflow-hidden rounded-full"
									role="progressbar"
									aria-label="Track progress"
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={Math.round(progress * 100)}
								>
									<div
										className="dashboard-widget-progress-fill h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
										style={{ width: `${progress * 100}%` }}
									/>
								</div>
								<span className="text-right">
									{`−${formatTime(duration - currentTime)}`}
								</span>
							</div>
						) : (
							<p className="dashboard-widget-muted flex h-[14px] items-center text-[10px]">
								{session
									? `${playing ? "Playing" : "Paused"} in ${session.artist}`
									: "Play audio in another tab"}
							</p>
						)}

						<div className="relative flex h-[42px] items-center justify-center gap-7">
							<button
								type="button"
								aria-label="Previous track"
								disabled={!session?.canPrevious || busyAction !== null}
								onClick={() => void onControl("previous")}
								className="grid size-10 place-items-center transition-opacity duration-150 disabled:opacity-35"
							>
								<Icon
									name="skip-back"
									size={27}
									fill="currentColor"
									strokeWidth={1.5}
									aria-hidden="true"
								/>
							</button>
							<button
								type="button"
								aria-label={playing ? "Pause" : "Play"}
								disabled={!session || busyAction !== null}
								onClick={() => void onControl(playing ? "pause" : "play")}
								className="grid size-11 place-items-center transition-opacity duration-150 disabled:opacity-35"
							>
								<Icon
									name={playing ? "pause" : "play"}
									size={34}
									fill="currentColor"
									strokeWidth={1.5}
									aria-hidden="true"
								/>
							</button>
							<button
								type="button"
								aria-label="Next track"
								disabled={!session?.canNext || busyAction !== null}
								onClick={() => void onControl("next")}
								className="grid size-10 place-items-center transition-opacity duration-150 disabled:opacity-35"
							>
								<Icon
									name="skip-forward"
									size={27}
									fill="currentColor"
									strokeWidth={1.5}
									aria-hidden="true"
								/>
							</button>
							<span className="absolute right-0">
								<AudioOutputPicker
									activeTabId={session?.tabId ?? null}
									onSelect={
										onSetOutput ??
										(() => Promise.resolve({ ok: false, reason: "no-media" }))
									}
									onEnumerate={enumerateMediaSessionOutputs}
								/>
							</span>
						</div>
					</>
				)}
			</div>
		</WidgetSurface>
	);
}
