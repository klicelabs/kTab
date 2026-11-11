import { Icon } from "@ktab/ui/icons/icon";
import { SPRING_PRESS } from "@ktab/ui/lib/ease";
import { DURATION, EASE } from "@ktab/ui/lib/motion";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { toast } from "sonner";
import { glassForeground, glassMaterial, glassShape } from "../../lib/glass";
import {
	REFRESH_STRINGS,
	type RefreshProgressEvent,
} from "../../lib/thumbnail-refresh";
import {
	requestRefreshSnapshot,
	sendRefreshCancel,
	subscribeRefreshProgress,
} from "../../lib/thumbnail-refresh-client";
import { cn } from "../../lib/utils";
import { useRefreshStore } from "../../stores/refresh-store";
import { useAppearance } from "./appearance-provider";

/** Single persistent toast id — one refresh toast at a time, by construction. */
const REFRESH_TOAST_ID = "ktab-refresh-progress";
const SUMMARY_DURATION_MS = 4000;
const RING_RADIUS = 18;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Calm background-operation feedback for thumbnail refresh. A single
 * persistent bottom-right Sonner custom toast, always expanded and fixed
 * to one shell: circular progress ring + "Capturing N of M", a two-row
 * capture log band (latest at bottom, reserved space, never a scroller),
 * and a keyboard-accessible cancel. On completion it crossfades in place
 * into a short summary ("10 updated, 2 failed" / "Cancelled at 3 of 10").
 *
 * No modal, no blocking, no banners — invisible until a refresh runs.
 */
export function RefreshProgressToast() {
	const active = useRefreshStore((s) => s.active);
	const summary = useRefreshStore((s) => s.summary);

	useEffect(() => {
		let disposed = false;
		let receivedLiveProgress = false;
		const unsubscribe = subscribeRefreshProgress((event) => {
			receivedLiveProgress = true;
			handleRefreshEvent(event);
		});
		void requestRefreshSnapshot().then((snapshot) => {
			if (
				disposed ||
				receivedLiveProgress ||
				useRefreshStore.getState().active ||
				!snapshot
			) {
				return;
			}
			useRefreshStore.getState().hydrateFromSession(snapshot);
		});
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, []);

	// One toast id for the whole lifecycle: progress MORPHS into the summary
	// via same-id update. Deliberately no effect cleanup that dismisses —
	// React runs the previous cleanup before the next effect, so a
	// dismiss-then-recreate in the same commit loses the toast in Sonner.
	// Dismissal happens only when neither state remains (or on unmount).
	useEffect(() => {
		if (active) {
			toast.custom(() => <RefreshRunningCard />, {
				id: REFRESH_TOAST_ID,
				duration: Number.POSITIVE_INFINITY,
				position: "bottom-right",
			});
			return undefined;
		}
		if (summary) {
			toast.custom(() => <RefreshSummaryCard />, {
				id: REFRESH_TOAST_ID,
				duration: SUMMARY_DURATION_MS,
				position: "bottom-right",
			});
			const timer = setTimeout(
				() => useRefreshStore.getState().dismissSummary(),
				SUMMARY_DURATION_MS,
			);
			return () => clearTimeout(timer);
		}
		toast.dismiss(REFRESH_TOAST_ID);
		return undefined;
	}, [active, summary]);

	useEffect(
		() => () => {
			toast.dismiss(REFRESH_TOAST_ID);
		},
		[],
	);

	return null;
}

function handleRefreshEvent(event: RefreshProgressEvent): void {
	useRefreshStore.getState().applyProgress(event);
	if (event.status === "already-running") {
		toast.info(REFRESH_STRINGS.alreadyRunning);
	} else if (event.status === "needs-permission") {
		toast.error(REFRESH_STRINGS.needsPermission, { duration: 6000 });
	}
}

function toastSurface(isLiquid: boolean): string {
	return cn(
		"refresh-progress-surface pointer-events-auto w-[min(22rem,calc(100vw-2rem))]",
		glassShape("panel"),
		glassMaterial(isLiquid, "menu", "dense"),
		isLiquid ? glassForeground() : "text-flat-ink",
		// Fixed shell: header + two log rows, always. Rows arrive, settle
		// and swap inside reserved space, so hover, expansion and content
		// updates never move the component — it only grows nowhere.
		"min-h-[118px] p-3.5 shadow-lg",
	);
}

/**
 * Motion language for the toast log: y-slide + opacity on the control
 * token, popLayout exit (no sibling push), the repo's signature ease.
 * Opacity-only when the user prefers reduced motion.
 */
const TOAST_ROW_TRANSITION = {
	duration: DURATION.control,
	ease: EASE.out,
};

function RefreshRunningCard() {
	const { isLiquid } = useAppearance();
	const reduceMotion = useReducedMotion() ?? false;
	const total = useRefreshStore((s) => s.total);
	const completed = useRefreshStore((s) => s.completed);
	const currentTitle = useRefreshStore((s) => s.currentTitle);
	const sites = useRefreshStore((s) => s.sites);

	const fraction = total > 0 ? Math.min(1, completed / total) : 0;
	// Two entries, never a scrolling log: the card under the camera at full
	// opacity, the previous one fading behind it like smoke. Keyed by card
	// so each result visibly arrives and recedes instead of swapping text
	// under stable slots; popLayout lifts the exiting row out of flow, so
	// neighbours never get pushed mid-flight.
	const visible = sites.slice(-2);

	return (
		<div className={toastSurface(isLiquid)}>
			<div className="flex items-center gap-3">
				<ProgressRing fraction={fraction} />
				<div role="status" aria-live="polite" className="min-w-0 flex-1">
					<p className="truncate font-medium text-[13px] leading-tight">
						{REFRESH_STRINGS.capturing(completed, total)}
					</p>
					{currentTitle ? (
						<p className="truncate text-[12px] opacity-70">{currentTitle}</p>
					) : null}
				</div>
				<motion.button
					type="button"
					onClick={() => void sendRefreshCancel()}
					aria-label={REFRESH_STRINGS.cancelRefresh}
					title={REFRESH_STRINGS.cancelRefresh}
					whileTap={reduceMotion ? undefined : { scale: 0.96 }}
					transition={SPRING_PRESS}
					className={cn(
						"inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						isLiquid
							? "bg-foreground/10 hover:bg-foreground/15"
							: "bg-flat-sunken-raised text-flat-ink-muted hover:text-flat-ink",
					)}
				>
					<Icon name="x" size={15} aria-hidden="true" />
				</motion.button>
			</div>
			{/* Reserved log band: fixed height, bottom-anchored. Early in a
			    run it holds empty space rather than growing the shell. */}
			<div
				role="log"
				aria-label="Capture log"
				className="mt-2.5 flex h-10 flex-col justify-end gap-1 overflow-hidden"
			>
				<AnimatePresence initial={false} mode="popLayout">
					{visible.map((site, index) => (
						<motion.div
							key={site.cardId}
							initial={
								reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }
							}
							animate={{
								opacity: index === visible.length - 1 ? 1 : 0.65,
								y: 0,
							}}
							exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
							transition={TOAST_ROW_TRANSITION}
							className={cn(
								"flex min-w-0 items-center gap-2 text-[12px]",
								// The previous result recedes without masking readable text.

								!site.ok && "text-red-600 dark:text-red-400",
							)}
						>
							<Icon
								name={site.ok ? "check" : "alert"}
								size={13}
								aria-hidden="true"
								className="shrink-0 opacity-70"
							/>
							<span className="min-w-0 flex-1 truncate opacity-80">
								{site.title}
							</span>
						</motion.div>
					))}
				</AnimatePresence>
			</div>
		</div>
	);
}

function ProgressRing({ fraction }: { fraction: number }) {
	return (
		<div
			role="progressbar"
			aria-label="Preview refresh progress"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(fraction * 100)}
			className="relative size-10 shrink-0"
		>
			<svg
				viewBox="0 0 44 44"
				className="size-10 -rotate-90"
				aria-hidden="true"
			>
				<circle
					cx="22"
					cy="22"
					r={RING_RADIUS}
					fill="none"
					strokeWidth="4"
					className="stroke-foreground/15"
				/>
				<circle
					cx="22"
					cy="22"
					r={RING_RADIUS}
					fill="none"
					strokeWidth="4"
					strokeLinecap="round"
					strokeDasharray={RING_CIRCUMFERENCE}
					strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
					className="stroke-[var(--ktab-accent)] transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
				/>
			</svg>
		</div>
	);
}

function RefreshSummaryCard() {
	const { isLiquid } = useAppearance();
	const reduceMotion = useReducedMotion() ?? false;
	const summary = useRefreshStore((s) => s.summary);
	if (!summary) return null;
	const text = summary.cancelled
		? REFRESH_STRINGS.cancelledAt(
				summary.updated + summary.failed,
				useRefreshStore.getState().total,
			)
		: REFRESH_STRINGS.completeSummary(summary.updated, summary.failed);
	return (
		<div className={toastSurface(isLiquid)}>
			{/* Same shell as the running card, content centered: the
			    progress-to-summary morph is a crossfade, never a resize. */}
			<motion.div
				role="status"
				initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
				animate={{ opacity: 1, y: 0 }}
				transition={TOAST_ROW_TRANSITION}
				className="flex min-h-[90px] items-center gap-2.5"
			>
				<Icon
					name={summary.failed === 0 && !summary.cancelled ? "check" : "info"}
					size={15}
					aria-hidden="true"
					className="shrink-0"
				/>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-[13px]">{text}</p>
					{summary.error ? (
						<p
							className="truncate text-[12px] opacity-70"
							title={summary.error}
						>
							{summary.error}
						</p>
					) : null}
				</div>
			</motion.div>
		</div>
	);
}
