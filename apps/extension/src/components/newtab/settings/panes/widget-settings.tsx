import { Input } from "@ktab/ui/components/input";
import { Switch } from "@ktab/ui/components/switch";
import { type FormEvent, useEffect, useId, useState } from "react";
import { cn } from "../../../../lib/utils";
import { useSetupStore } from "../../../../stores/setup-store";
import type { Settings } from "../../../../types";
import { SectionCard } from "../shared/section-card";
import { SelectRow } from "../shared/select-row";
import { SettingRow } from "../shared/setting-row";
import { SettingsAction } from "../shared/settings-action";
import { SettingsExpandable } from "../shared/settings-expandable";
import {
	SETTINGS_FOCUS_RING,
	SETTINGS_INPUT,
	SETTINGS_RADIUS,
	SETTINGS_SWITCH,
} from "../shared/settings-tokens";

const COMMON_APPEARANCE_OPTIONS = [
	{ value: "flat", label: "Flat" },
	{ value: "glass", label: "Liquid Glass" },
] as const;

const MUSIC_APPEARANCE_OPTIONS = [
	...COMMON_APPEARANCE_OPTIONS,
	{ value: "album-blur", label: "Album Blur" },
] as const;

const WIDGET_SIZE_OPTIONS = [
	{ value: "compact", label: "Compact" },
	{ value: "expanded", label: "Expanded" },
] as const;

const GITHUB_PALETTE_OPTIONS = [
	{ value: "github", label: "GitHub green" },
	{ value: "blue", label: "Blue" },
	{ value: "purple", label: "Purple" },
	{ value: "orange", label: "Orange" },
	{ value: "monochrome", label: "Monochrome" },
] as const;

interface MarketPresetGroup {
	label: string;
	items: readonly { symbol: string; name: string }[];
}

const MARKET_PRESET_GROUPS: readonly MarketPresetGroup[] = [
	{
		label: "US stocks",
		items: [
			{ symbol: "AAPL", name: "Apple" },
			{ symbol: "NVDA", name: "NVIDIA" },
			{ symbol: "TSLA", name: "Tesla" },
			{ symbol: "MSFT", name: "Microsoft" },
		],
	},
	{
		label: "Brazil",
		items: [
			{ symbol: "^BVSP", name: "Ibovespa" },
			{ symbol: "PETR4.SA", name: "Petrobras PN" },
			{ symbol: "VALE3.SA", name: "Vale ON" },
		],
	},
	{
		label: "Crypto and currencies",
		items: [
			{ symbol: "BTC-USD", name: "Bitcoin" },
			{ symbol: "ETH-USD", name: "Ethereum" },
			{ symbol: "USDBRL=X", name: "US dollar / Brazilian real" },
		],
	},
] as const;

function marketTickerLabel(ticker: string): string {
	return (
		MARKET_PRESET_GROUPS.flatMap((group) => group.items).find(
			(item) => item.symbol === ticker,
		)?.name ?? ticker
	);
}

function tickerIsValid(ticker: string): boolean {
	return /^[A-Z0-9.^=_-]{1,16}$/.test(ticker);
}

export function WidgetSettings() {
	const widgets = useSetupStore((state) => state.settings.widgets);
	const updateSettings = useSetupStore((state) => state.updateSettings);
	const [usernameDraft, setUsernameDraft] = useState(widgets.github.username);
	const [tokenDraft, setTokenDraft] = useState(widgets.github.token);
	const [marketSearch, setMarketSearch] = useState("");
	const [customTicker, setCustomTicker] = useState("");
	const [marketMessage, setMarketMessage] = useState("");
	const usernameId = useId();
	const tokenId = useId();
	const marketSearchId = useId();
	const customTickerId = useId();

	useEffect(
		() => setUsernameDraft(widgets.github.username),
		[widgets.github.username],
	);
	useEffect(() => setTokenDraft(widgets.github.token), [widgets.github.token]);

	function updateMusic(changes: Partial<Settings["widgets"]["music"]>) {
		updateSettings({
			widgets: { ...widgets, music: { ...widgets.music, ...changes } },
		});
	}
	function updateMarket(changes: Partial<Settings["widgets"]["market"]>) {
		updateSettings({
			widgets: { ...widgets, market: { ...widgets.market, ...changes } },
		});
	}
	function updateGitHub(changes: Partial<Settings["widgets"]["github"]>) {
		updateSettings({
			widgets: { ...widgets, github: { ...widgets.github, ...changes } },
		});
	}
	function addMarketTicker(value: string) {
		const ticker = value.trim().toUpperCase();
		if (!tickerIsValid(ticker)) {
			setMarketMessage("Enter a valid ticker, such as AAPL or PETR4.SA.");
			return false;
		}
		if (widgets.market.tickers.includes(ticker)) {
			setMarketMessage(`${ticker} is already on your list.`);
			return false;
		}
		if (widgets.market.tickers.length >= 3) {
			setMarketMessage(
				"You can track up to three assets. Remove one to add another.",
			);
			return false;
		}
		updateMarket({ tickers: [...widgets.market.tickers, ticker] });
		setMarketMessage(`${marketTickerLabel(ticker)} added.`);
		setCustomTicker("");
		return true;
	}
	function removeMarketTicker(ticker: string) {
		updateMarket({
			tickers: widgets.market.tickers.filter((item) => item !== ticker),
		});
		setMarketMessage(`${marketTickerLabel(ticker)} removed.`);
	}
	function submitCustomTicker(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		addMarketTicker(customTicker);
	}

	const normalizedMarketSearch = marketSearch.trim().toLocaleLowerCase();
	const filteredMarketGroups = MARKET_PRESET_GROUPS.map((group) => ({
		...group,
		items: group.items.filter((item) =>
			`${group.label} ${item.symbol} ${item.name}`
				.toLocaleLowerCase()
				.includes(normalizedMarketSearch),
		),
	})).filter((group) => group.items.length > 0);

	return (
		<>
			<SectionCard>
				<SettingRow
					label="Music"
					icon="music"
					tooltip="Show and control media playing in browser tabs."
				>
					<Switch
						className={SETTINGS_SWITCH}
						aria-label="Show music widget"
						checked={widgets.music.enabled}
						onCheckedChange={(enabled) => updateMusic({ enabled })}
					/>
				</SettingRow>
				<SettingsExpandable
					expanded={widgets.music.enabled}
					label="Music options"
				>
					<SelectRow
						label="Appearance"
						icon="sparkles"
						value={widgets.music.appearance}
						options={MUSIC_APPEARANCE_OPTIONS}
						onChange={(appearance) => updateMusic({ appearance })}
					/>
					<SelectRow
						label="Size"
						icon="layout"
						value={widgets.music.size}
						options={WIDGET_SIZE_OPTIONS}
						onChange={(size) => updateMusic({ size })}
					/>
				</SettingsExpandable>
			</SectionCard>

			<SectionCard>
				<SettingRow
					label="Market"
					icon="market"
					tooltip="Follow up to three stocks, indices, crypto assets, or exchange rates."
				>
					<Switch
						className={SETTINGS_SWITCH}
						aria-label="Show market widget"
						checked={widgets.market.enabled}
						onCheckedChange={(enabled) => updateMarket({ enabled })}
					/>
				</SettingRow>
				<SettingsExpandable
					expanded={widgets.market.enabled}
					label="Market options"
				>
					<SelectRow
						label="Appearance"
						icon="sparkles"
						value={widgets.market.appearance}
						options={COMMON_APPEARANCE_OPTIONS}
						onChange={(appearance) => updateMarket({ appearance })}
					/>
					<SelectRow
						label="Size"
						icon="layout"
						value={widgets.market.size}
						options={WIDGET_SIZE_OPTIONS}
						onChange={(size) => updateMarket({ size })}
					/>
					<div className="grid gap-2 px-1.5 py-2">
						<label
							htmlFor={marketSearchId}
							className="font-medium text-[12px] text-neutral-800 dark:text-neutral-200"
						>
							Find a popular asset
						</label>
						<Input
							id={marketSearchId}
							type="search"
							value={marketSearch}
							placeholder="Search by company or ticker"
							autoComplete="off"
							onChange={(event) => setMarketSearch(event.target.value)}
							className={`h-8 px-2 text-[12px] ${SETTINGS_RADIUS.control} ${SETTINGS_INPUT}`}
						/>
						<p className="text-[11px] text-neutral-500 dark:text-neutral-400">
							{widgets.market.tickers.length} of 3 assets selected. Choose one
							to add it.
						</p>
						<div className="grid gap-2">
							{filteredMarketGroups.map((group) => (
								<div key={group.label} className="grid gap-1">
									<p className="font-medium text-[11px] text-neutral-600 dark:text-neutral-300">
										{group.label}
									</p>
									<div className="flex flex-wrap gap-1.5">
										{group.items.map((item) => {
											const selected = widgets.market.tickers.includes(
												item.symbol,
											);
											const full = widgets.market.tickers.length >= 3;
											return (
												<button
													key={item.symbol}
													type="button"
													disabled={selected || full}
													onClick={() => addMarketTicker(item.symbol)}
													aria-label={
														selected
															? `${item.name} (${item.symbol}) already selected`
															: `Add ${item.name} (${item.symbol})`
													}
													className={cn(
														"inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-neutral-800 transition-colors duration-150 hover:bg-neutral-900/[0.06] disabled:opacity-45 dark:text-neutral-100 dark:hover:bg-white/[0.07]",
														SETTINGS_FOCUS_RING,
													)}
													title={
														selected ? "Already selected" : `Add ${item.name}`
													}
												>
													<span className="font-semibold">{item.symbol}</span>
													<span className="text-neutral-500 dark:text-neutral-400">
														{selected ? "Added" : item.name}
													</span>
												</button>
											);
										})}
									</div>
								</div>
							))}
							{filteredMarketGroups.length === 0 ? (
								<p className="text-[11px] text-neutral-500 dark:text-neutral-400">
									No popular assets match that search.
								</p>
							) : null}
						</div>
						<form
							className="flex items-center gap-2"
							onSubmit={submitCustomTicker}
						>
							<label className="sr-only" htmlFor={customTickerId}>
								Add another ticker
							</label>
							<Input
								id={customTickerId}
								maxLength={16}
								autoCapitalize="characters"
								autoComplete="off"
								placeholder="Or enter a ticker, such as IBM"
								value={customTicker}
								onChange={(event) =>
									setCustomTicker(event.target.value.toUpperCase())
								}
								className={`h-8 min-w-0 flex-1 px-2 text-[12px] ${SETTINGS_RADIUS.control} ${SETTINGS_INPUT}`}
							/>
							<SettingsAction
								type="submit"
								disabled={widgets.market.tickers.length >= 3}
								className="h-8 px-2 text-[11px]"
							>
								Add ticker
							</SettingsAction>
						</form>
						{widgets.market.tickers.length > 0 ? (
							<ul className="grid gap-1" aria-label="Selected market assets">
								{widgets.market.tickers.map((ticker) => (
									<li
										key={ticker}
										className="flex min-h-8 items-center justify-between gap-2 rounded-md bg-neutral-900/[0.04] px-2 dark:bg-white/[0.04]"
									>
										<span className="min-w-0 truncate text-[11px] text-neutral-700 dark:text-neutral-200">
											<span className="font-semibold">{ticker}</span>
											<span className="ml-1.5 text-neutral-500 dark:text-neutral-400">
												{marketTickerLabel(ticker)}
											</span>
										</span>
										<SettingsAction
											aria-label={`Remove ${ticker}`}
											onClick={() => removeMarketTicker(ticker)}
											className="h-6 px-1.5 text-[10px]"
										>
											Remove
										</SettingsAction>
									</li>
								))}
							</ul>
						) : null}
						<p
							role="status"
							className="min-h-4 text-[11px] text-neutral-500 dark:text-neutral-400"
						>
							{marketMessage ||
								"Quotes are cached on this device and refreshed automatically."}
						</p>
					</div>
				</SettingsExpandable>
			</SectionCard>

			<SectionCard>
				<SettingRow
					label="GitHub"
					icon="github"
					tooltip="Show your contribution calendar and activity metrics."
				>
					<Switch
						className={SETTINGS_SWITCH}
						aria-label="Show GitHub widget"
						checked={widgets.github.enabled}
						onCheckedChange={(enabled) => updateGitHub({ enabled })}
					/>
				</SettingRow>
				<SettingsExpandable
					expanded={widgets.github.enabled}
					label="GitHub options"
				>
					<SelectRow
						label="Appearance"
						icon="sparkles"
						value={widgets.github.appearance}
						options={COMMON_APPEARANCE_OPTIONS}
						onChange={(appearance) => updateGitHub({ appearance })}
					/>
					<SelectRow
						label="Size"
						icon="layout"
						value={widgets.github.size}
						options={WIDGET_SIZE_OPTIONS}
						onChange={(size) => updateGitHub({ size })}
					/>
					<SelectRow
						label="Contribution colors"
						icon="palette"
						value={widgets.github.palette}
						options={GITHUB_PALETTE_OPTIONS}
						onChange={(palette) => updateGitHub({ palette })}
					/>
					<label
						htmlFor={usernameId}
						className="grid gap-1 px-1.5 py-1.5 text-[12px] text-neutral-700 dark:text-neutral-300"
					>
						GitHub username
						<Input
							id={usernameId}
							aria-label="GitHub username"
							maxLength={39}
							autoComplete="off"
							placeholder="e.g. torvalds"
							value={usernameDraft}
							onChange={(event) => setUsernameDraft(event.target.value)}
							onBlur={() => updateGitHub({ username: usernameDraft })}
							className={`h-9 px-3 text-sm ${SETTINGS_RADIUS.control} ${SETTINGS_INPUT}`}
						/>
					</label>
					<label
						htmlFor={tokenId}
						className="grid gap-1 px-1.5 py-1.5 text-[12px] text-neutral-700 dark:text-neutral-300"
					>
						Personal access token (optional)
						<Input
							id={tokenId}
							aria-label="GitHub personal access token"
							maxLength={512}
							autoComplete="new-password"
							type="password"
							placeholder="Read:user scope for private contribution counts"
							value={tokenDraft}
							onChange={(event) => setTokenDraft(event.target.value)}
							onBlur={() => updateGitHub({ token: tokenDraft })}
							className={`h-9 px-3 text-sm ${SETTINGS_RADIUS.control} ${SETTINGS_INPUT}`}
						/>
					</label>
					<p className="text-pretty px-1.5 py-1 text-[11px] text-neutral-500 leading-[1.45] dark:text-neutral-400">
						Your token stays in this browser profile and is sent only to GitHub.
						Without a token, the contribution calendar uses public profile data.
					</p>
				</SettingsExpandable>
			</SectionCard>
		</>
	);
}
