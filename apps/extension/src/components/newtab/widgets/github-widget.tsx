import { Tooltip } from "@ktab/ui/components/motion/tooltip";
import { Icon } from "@ktab/ui/icons/icon";
import { useEffect, useState } from "react";
import { getWidgetCache, putWidgetCache } from "../../../lib/idb";
import { subscribeWidgetAction } from "../../../lib/widget-actions";
import { formatCompactCount } from "../../../lib/widget-format";
import {
	fetchGitHubWidgetData,
	type GitHubWidgetData,
} from "../../../services/github-widget-data";
import { useSetupStore } from "../../../stores/setup-store";
import type {
	GitHubHeatmapPalette,
	WidgetAppearance,
	WidgetSizePreference,
} from "../../../types";
import { WidgetSurface } from "./widget-surface";

const CACHE_AGE = 60 * 60 * 1000;
const AXES = ["Commit", "Issue", "PullReq", "Review", "Repo"] as const;

function isGitHubData(value: unknown): value is GitHubWidgetData {
	return (
		typeof value === "object" &&
		value !== null &&
		"contributions" in value &&
		"radars" in value
	);
}

function radarPoint(
	index: number,
	fraction: number,
	radius: number,
): [number, number] {
	const angle = (-90 + index * 72) * (Math.PI / 180);
	const scaledRadius = radius * fraction;
	return [
		80 + Math.cos(angle) * scaledRadius,
		70 + Math.sin(angle) * scaledRadius,
	];
}

function polygonPoints(fraction: number, radius: number): string {
	return AXES.map((_, index) =>
		radarPoint(index, fraction, radius).join(","),
	).join(" ");
}

function metricFraction(value: number): number {
	const normalized = Math.min(10_000, Math.max(1, value));
	return 0.1 + (Math.log10(normalized) / 4) * 0.9;
}

function RadarChart({
	data,
	color,
}: {
	data: GitHubWidgetData["radars"];
	color: string;
}) {
	const values = [
		data.commits,
		data.issues,
		data.pullRequests,
		data.reviews,
		data.repositories,
	];
	const points = values
		.map((value, index) =>
			radarPoint(index, metricFraction(value), 38).join(","),
		)
		.join(" ");
	const numberFormat = new Intl.NumberFormat(
		typeof navigator !== "undefined" ? navigator.language : "en-US",
	);
	return (
		<div className="relative h-full w-full">
			<svg
				viewBox="0 0 160 142"
				className="h-full w-full overflow-visible"
				role="img"
				aria-label={`GitHub activity radar: commits ${data.commits}, issues ${data.issues}, pull requests ${data.pullRequests}, reviews ${data.reviews}, repositories ${data.repositories}`}
			>
				<g
					fill="none"
					stroke="currentColor"
					strokeOpacity=".24"
					strokeWidth=".65"
				>
					{[0.2, 0.4, 0.6, 0.8, 1].map((fraction) => (
						<polygon key={fraction} points={polygonPoints(fraction, 38)} />
					))}
					{AXES.map((axis, index) => {
						const [x, y] = radarPoint(index, 1, 38);
						return <line key={axis} x1="80" y1="70" x2={x} y2={y} />;
					})}
				</g>
				<polygon
					points={points}
					fill={color}
					fillOpacity=".22"
					stroke={color}
					strokeWidth="1.5"
				/>
				{["1", "10", "100", "1K", "10K"].map((label, index) => (
					<text
						key={label}
						x="83"
						y={68 - (index + 1) * 7.5}
						fill="currentColor"
						fillOpacity=".66"
						fontSize="5.5"
					>
						{label}
					</text>
				))}
				<g fill="currentColor" fontSize="7" fontWeight="600">
					<text x="80" y="13" textAnchor="middle">
						Commit
					</text>
					<text x="127" y="46" textAnchor="start">
						Issue
					</text>
					<text x="119" y="119" textAnchor="start">
						PullReq
					</text>
					<text x="79" y="139" textAnchor="middle">
						Review
					</text>
					<text x="27" y="46" textAnchor="end">
						Repo
					</text>
				</g>
			</svg>
			{values.map((value, index) => {
				const [x, y] = radarPoint(index, metricFraction(value), 38);
				const axis = AXES[index];
				return (
					<span
						key={axis}
						className="absolute -translate-x-1/2 -translate-y-1/2"
						style={{ left: `${(x / 160) * 100}%`, top: `${(y / 142) * 100}%` }}
					>
						<Tooltip
							content={`${axis}: ${numberFormat.format(value)}`}
							delay={100}
						>
							<button
								type="button"
								aria-label={`${axis}: ${numberFormat.format(value)}`}
								className="grid size-3 place-items-center rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[var(--ktab-accent)]"
							/>
						</Tooltip>
					</span>
				);
			})}
		</div>
	);
}

const PALETTE_RGB: Record<GitHubHeatmapPalette, [number, number, number]> = {
	github: [35, 134, 54],
	blue: [56, 139, 253],
	purple: [163, 113, 247],
	orange: [218, 129, 35],
	monochrome: [150, 150, 150],
};

function ContributionHeatmap({
	data,
	compact,
	palette,
}: {
	data: GitHubWidgetData;
	compact: boolean;
	palette: GitHubHeatmapPalette;
}) {
	const rgb = PALETTE_RGB[palette];
	const maximum = Math.max(1, data.best);
	return (
		<fieldset className="m-0 min-w-0 border-0 p-0">
			<legend className="sr-only">Last 70 days of GitHub contributions</legend>
			<div
				className={
					compact
						? "grid h-[74px] w-full grid-flow-col grid-cols-10 grid-rows-7 gap-[3px]"
						: "grid h-[132px] w-full grid-flow-col grid-cols-10 grid-rows-7 gap-[4px]"
				}
			>
				{data.contributions.slice(-70).map((day) => {
					const intensity = Math.log1p(day.count) / Math.log1p(maximum);
					const alpha = day.count === 0 ? 0.12 : 0.28 + intensity * 0.68;
					const date = new Date(`${day.date}T12:00:00`);
					const dateLabel = new Intl.DateTimeFormat(
						typeof navigator !== "undefined" ? navigator.language : "en-US",
						{ month: "short", day: "numeric" },
					).format(date);
					const label = `${day.count} ${day.count === 1 ? "contribution" : "contributions"} on ${dateLabel}`;
					return (
						<Tooltip
							key={day.date}
							content={label}
							delay={90}
							wrapperClassName="min-h-0 min-w-0"
						>
							<button
								type="button"
								aria-label={label}
								className="block size-full rounded-[2px] border-0 p-0 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ktab-accent)]"
								style={{ backgroundColor: `rgba(${rgb.join(",")}, ${alpha})` }}
							/>
						</Tooltip>
					);
				})}
			</div>
		</fieldset>
	);
}

export function GitHubWidget() {
	const settings = useSetupStore((state) => state.settings.widgets.github);
	const [data, setData] = useState<GitHubWidgetData | null>(null);
	const [status, setStatus] = useState<"loading" | "ready" | "error">(
		"loading",
	);
	const [refreshCount, setRefreshCount] = useState(0);
	const username = settings.username.trim();
	const cacheKey = `github:${username.toLowerCase()}:${settings.token ? "authenticated" : "public"}`;

	useEffect(() => {
		if (!settings.enabled) return;
		return subscribeWidgetAction("github", "refresh", () =>
			setRefreshCount((count) => count + 1),
		);
	}, [settings.enabled]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Clicking retry intentionally re-runs the cache lookup and fetch.
	useEffect(() => {
		if (!settings.enabled || !username) return;
		let active = true;
		const controller = new AbortController();
		const refresh = async () => {
			try {
				const result = await fetchGitHubWidgetData(username, settings.token, {
					signal: controller.signal,
				});
				if (!active) return;
				setData(result);
				setStatus("ready");
				void putWidgetCache(cacheKey, {
					fetchedAt: Date.now(),
					value: result,
				}).catch(() => undefined);
			} catch {
				if (active && !controller.signal.aborted) setStatus("error");
			}
		};
		void getWidgetCache<GitHubWidgetData>(cacheKey)
			.then((cached) => {
				if (!active) return;
				if (cached && isGitHubData(cached.value)) {
					setData(cached.value);
					setStatus("ready");
					if (Date.now() - cached.fetchedAt < CACHE_AGE) return;
				}
				void refresh();
			})
			.catch(() => void refresh());
		const timer = window.setInterval(() => void refresh(), CACHE_AGE);
		return () => {
			active = false;
			window.clearInterval(timer);
			controller.abort();
		};
	}, [cacheKey, refreshCount, settings.enabled, settings.token, username]);

	if (!settings.enabled) return null;
	return (
		<GitHubWidgetView
			appearance={settings.appearance}
			size={settings.size}
			palette={settings.palette}
			username={username}
			data={data}
			status={status}
			onRefresh={() => setRefreshCount((count) => count + 1)}
		/>
	);
}

export function GitHubWidgetView({
	appearance,
	size = "expanded",
	palette = "github",
	username,
	data,
	status,
	onRefresh,
}: {
	appearance: WidgetAppearance;
	size?: WidgetSizePreference;
	palette?: GitHubHeatmapPalette;
	username: string;
	data: GitHubWidgetData | null;
	status: "loading" | "ready" | "error";
	onRefresh?: () => void;
}) {
	if (!username) {
		return (
			<WidgetSurface
				name="github"
				size={size}
				appearance={appearance}
				className="items-center justify-center p-3 text-center"
			>
				<Icon
					name="github"
					size={23}
					className="dashboard-widget-muted mb-2"
					aria-hidden="true"
				/>
				<p className="font-semibold text-[13px]">GitHub activity</p>
				<p className="dashboard-widget-muted mt-1 text-[10px]">
					Add a username in Settings to show your contributions.
				</p>
			</WidgetSurface>
		);
	}
	return (
		<WidgetSurface
			name="github"
			size={size}
			appearance={appearance}
			className="p-3"
		>
			{data ? (
				size === "compact" ? (
					<div className="flex h-full min-h-0 flex-col justify-between">
						<div className="grid grid-cols-3 gap-1">
							{[
								["Today", data.today],
								["Best", data.best],
								["Total", data.total],
							].map(([label, value]) => (
								<div key={label} className="min-w-0">
									<p className="truncate font-semibold text-[13px] leading-none">
										{formatCompactCount(Number(value))}
									</p>
									<p className="dashboard-widget-muted mt-1 text-[8px] leading-none">
										{label}
									</p>
								</div>
							))}
						</div>
						<ContributionHeatmap data={data} compact palette={palette} />
					</div>
				) : (
					<div className="grid h-full min-h-0 grid-cols-[1fr_1fr] gap-1.5">
						<div className="flex min-w-0 flex-col justify-between">
							<div className="grid grid-cols-3 gap-1">
								{[
									["Today", data.today],
									["Best", data.best],
									["Total", data.total],
								].map(([label, value]) => (
									<div key={label} className="min-w-0">
										<p className="truncate font-semibold text-[13px] leading-none">
											{formatCompactCount(Number(value))}
										</p>
										<p className="dashboard-widget-muted mt-1 text-[8px] leading-none">
											{label}
										</p>
									</div>
								))}
							</div>
							<ContributionHeatmap
								data={data}
								compact={false}
								palette={palette}
							/>
						</div>
						<div className="min-w-0 pl-1">
							<RadarChart data={data.radars} color="var(--ktab-accent)" />
							{data.dataScope === "public" ? (
								<p className="sr-only">
									Metrics use publicly visible activity.
								</p>
							) : null}
						</div>
					</div>
				)
			) : (
				<div className="dashboard-widget-muted flex h-full items-center justify-center gap-2 text-[11px]">
					{status === "error"
						? "GitHub data unavailable"
						: `Loading @${username}…`}
					{status === "error" ? (
						<button
							type="button"
							aria-label="Refresh GitHub data"
							onClick={onRefresh}
							className="grid h-7 w-7 place-items-center rounded-full bg-white/10"
						>
							<Icon name="refresh" size={13} aria-hidden="true" />
						</button>
					) : null}
				</div>
			)}
		</WidgetSurface>
	);
}
