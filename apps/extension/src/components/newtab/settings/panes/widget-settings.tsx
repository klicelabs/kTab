import { Input } from "@ktab/ui/components/input";
import { Switch } from "@ktab/ui/components/switch";
import { useEffect, useState } from "react";
import { useSetupStore } from "../../../../stores/setup-store";
import type { Settings } from "../../../../types";
import { SectionCard } from "../shared/section-card";
import { SelectRow } from "../shared/select-row";
import { SettingRow } from "../shared/setting-row";
import { SettingsExpandable } from "../shared/settings-expandable";
import {
	SETTINGS_CONTROL_WIDTH,
	SETTINGS_INPUT,
	SETTINGS_RADIUS,
	SETTINGS_SWITCH,
} from "../shared/settings-tokens";

const APPEARANCE_OPTIONS = [
	{ value: "flat", label: "Flat" },
	{ value: "glass", label: "Liquid Glass" },
] as const;

export function WidgetSettings() {
	const widgets = useSetupStore((state) => state.settings.widgets);
	const updateSettings = useSetupStore((state) => state.updateSettings);
	const [usernameDraft, setUsernameDraft] = useState(widgets.github.username);
	const [tokenDraft, setTokenDraft] = useState(widgets.github.token);

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
						options={APPEARANCE_OPTIONS}
						onChange={(appearance) => updateMusic({ appearance })}
					/>
				</SettingsExpandable>
			</SectionCard>

			<SectionCard>
				<SettingRow
					label="Market"
					icon="market"
					tooltip="Track up to three stocks, indices, or crypto tickers."
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
						options={APPEARANCE_OPTIONS}
						onChange={(appearance) => updateMarket({ appearance })}
					/>
					{[0, 1, 2].map((index) => {
						const inputId = `market-ticker-${index + 1}`;
						return (
							<div
								key={inputId}
								className="flex items-center gap-2 px-1.5 py-1"
							>
								<label
									htmlFor={inputId}
									className="w-14 shrink-0 text-[12px] text-neutral-600 dark:text-neutral-400"
								>
									Ticker {index + 1}
								</label>
								<Input
									id={inputId}
									aria-label={`Market ticker ${index + 1}`}
									maxLength={16}
									autoCapitalize="characters"
									placeholder={
										index === 0 ? "^BVSP" : index === 1 ? "DIS" : "AAPL"
									}
									value={widgets.market.tickers[index] ?? ""}
									onChange={(event) => {
										const tickers = [...widgets.market.tickers];
										tickers[index] = event.target.value.toUpperCase();
										updateMarket({ tickers });
									}}
									className={`${SETTINGS_CONTROL_WIDTH} h-8 px-2 text-[12px] ${SETTINGS_RADIUS.control} ${SETTINGS_INPUT}`}
								/>
							</div>
						);
					})}
					<p className="px-1.5 py-1 text-[11px] text-neutral-500 dark:text-neutral-400">
						Quotes are read from Yahoo Finance and cached on this device.
					</p>
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
						options={APPEARANCE_OPTIONS}
						onChange={(appearance) => updateGitHub({ appearance })}
					/>
					<label
						htmlFor="github-username"
						className="grid gap-1 px-1.5 py-1.5 text-[12px] text-neutral-700 dark:text-neutral-300"
					>
						GitHub username
						<Input
							id="github-username"
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
						htmlFor="github-token"
						className="grid gap-1 px-1.5 py-1.5 text-[12px] text-neutral-700 dark:text-neutral-300"
					>
						Personal access token (optional)
						<Input
							id="github-token"
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
