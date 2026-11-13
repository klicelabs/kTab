import { Icon } from "@ktab/ui/icons/icon";
import { useEffect, useMemo, useState } from "react";
import {
	controlMediaSession,
	queryMediaSessions,
	type MediaControlAction,
	type MediaSessionSnapshot,
} from "../../../lib/media-session";
import { useSetupStore } from "../../../stores/setup-store";
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

export function MusicWidget() {
	const settings = useSetupStore((state) => state.settings.widgets.music);
	const [session, setSession] = useState<MediaSessionSnapshot | null>(null);
	const [busyAction, setBusyAction] = useState<MediaControlAction | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Re-query after a media control reports its result.
	useEffect(() => {
		if (!settings.enabled) return;
		let active = true;
		const update = async () => {
			const sessions = await queryMediaSessions();
			if (active) setSession(sessions[0] ?? null);
		};
		void update();
		const interval = window.setInterval(() => void update(), 1200);
		return () => {
			active = false;
			window.clearInterval(interval);
		};
	}, [refreshKey, settings.enabled]);

	if (!settings.enabled) return null;

	async function control(action: MediaControlAction) {
		if (!session || busyAction) return;
		setBusyAction(action);
		const ok = await controlMediaSession(session.tabId, action);
		if (!ok) setSession(null);
		setBusyAction(null);
		setRefreshKey((key) => key + 1);
	}
	return (
		<MusicWidgetView
			appearance={settings.appearance}
			session={session}
			busyAction={busyAction}
			onControl={control}
		/>
	);
}

export function MusicWidgetView({
	appearance,
	session,
	busyAction,
	onControl,
}: {
	appearance: "flat" | "glass";
	session: MediaSessionSnapshot | null;
	busyAction: MediaControlAction | null;
	onControl: (action: MediaControlAction) => void | Promise<void>;
}) {
	const artwork = useMemo(
		() => safeArtworkUrl(session?.artwork ?? null),
		[session?.artwork],
	);
	const duration = session?.duration ?? 0;
	const currentTime = session?.currentTime ?? 0;
	const progress =
		duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
	const playing = session?.playing === true;
	const isActive = Boolean(session);

	return (
		<WidgetSurface
			name="music"
			size="wide"
			appearance={appearance}
			className="p-3"
		>
			<div className="flex h-full min-h-0 flex-col justify-between gap-2">
				<div className="flex min-w-0 items-center gap-3">
					<div className="squircle grid h-[64px] w-[64px] shrink-0 place-items-center overflow-hidden rounded-[var(--shape-thumb,12px)] bg-gradient-to-br from-white/25 via-black/30 to-black/70 ring-1 ring-white/10 [--squircle-r:var(--shape-thumb-fallback,7px)]">
						{artwork ? (
							<img
								src={artwork}
								alt=""
								referrerPolicy="no-referrer"
								loading="lazy"
								className="h-full w-full object-cover"
								onError={(event) => {
									event.currentTarget.style.display = "none";
								}}
							/>
						) : (
							<Icon
								name="music"
								size={25}
								className="text-white/75"
								aria-hidden="true"
							/>
						)}
					</div>
					<div className="min-w-0 flex-1">
						<p className="truncate font-semibold text-[14px] leading-[1.25]">
							{session?.title ?? "Nothing playing"}
						</p>
						<p className="mt-0.5 truncate text-[13px] text-white/55 leading-[1.25]">
							{session?.artist ?? "Start audio in any browser tab"}
						</p>
					</div>
					<div className="grid h-8 w-8 shrink-0 place-items-center text-white/60">
						<SoundBars playing={playing} />
					</div>
				</div>

				<div className="grid grid-cols-[34px_1fr_40px] items-center gap-2 text-[10px] text-white/70 tabular-nums">
					<span>{isActive ? formatTime(currentTime) : "0:00"}</span>
					<div
						className="h-[4px] overflow-hidden rounded-full bg-white/15"
						role="progressbar"
						aria-label="Track progress"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(progress * 100)}
					>
						<div
							className="h-full rounded-full bg-white/70 transition-[width] duration-500"
							style={{ width: `${progress * 100}%` }}
						/>
					</div>
					<span className="text-right">
						{duration > 0 ? `−${formatTime(duration - currentTime)}` : "−0:00"}
					</span>
				</div>

				<div className="relative flex h-[42px] items-center justify-center gap-7">
					<button
						type="button"
						aria-label="Previous track"
						aria-disabled={!session?.canPrevious || busyAction !== null}
						disabled={!session?.canPrevious || busyAction !== null}
						onClick={() => void onControl("previous")}
						className="grid h-10 w-10 place-items-center text-white/90 disabled:opacity-35"
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
						className="grid h-11 w-11 place-items-center text-white disabled:opacity-35"
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
						aria-disabled={!session?.canNext || busyAction !== null}
						disabled={!session?.canNext || busyAction !== null}
						onClick={() => void onControl("next")}
						className="grid h-10 w-10 place-items-center text-white/90 disabled:opacity-35"
					>
						<Icon
							name="skip-forward"
							size={27}
							fill="currentColor"
							strokeWidth={1.5}
							aria-hidden="true"
						/>
					</button>
					<span
						className="absolute right-1 grid h-8 w-8 place-items-center text-white/50"
						aria-hidden="true"
					>
						<Icon name="headphones" size={20} />
					</span>
				</div>
			</div>
		</WidgetSurface>
	);
}
