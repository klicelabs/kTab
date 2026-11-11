import { Input } from "@ktab/ui/components/input";
import { Switch } from "@ktab/ui/components/switch";
import { type FormEvent, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import {
	DEFAULT_MACOSICONS_SETTINGS,
	getMacOSiconsSettings,
	type MacOSiconsSettings,
	saveMacOSiconsSettings,
} from "../../../../services/macosicons";
import { SectionCard } from "../shared/section-card";
import { SettingsAction } from "../shared/settings-action";

export function IconProviderSettings() {
	const keyInputId = useId();
	const helpId = useId();
	const switchLabelId = useId();
	const [settings, setSettings] = useState<MacOSiconsSettings>({
		...DEFAULT_MACOSICONS_SETTINGS,
	});
	const [saved, setSaved] = useState<MacOSiconsSettings>({
		...DEFAULT_MACOSICONS_SETTINGS,
	});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let active = true;
		void getMacOSiconsSettings().then((current) => {
			if (!active) return;
			setSettings(current);
			setSaved(current);
			setLoading(false);
		});
		return () => {
			active = false;
		};
	}, []);

	const changed =
		settings.enabled !== saved.enabled || settings.apiKey !== saved.apiKey;

	async function handleSave(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		try {
			const next = {
				enabled: settings.enabled,
				apiKey: settings.apiKey.trim(),
			};
			await saveMacOSiconsSettings(next);
			setSettings(next);
			setSaved(next);
			toast.success("Icon source settings saved.");
		} catch {
			toast.error("Icon source settings could not be saved.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<SectionCard className="p-4">
			<form className="flex min-w-0 flex-col gap-3" onSubmit={handleSave}>
				<div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
					<div className="min-w-0 flex-1">
						<h3 className="font-medium text-[13px] text-neutral-800 dark:text-neutral-200">
							Online icon sources
						</h3>
						<p
							className="mt-1 max-w-[54ch] text-[12px] text-neutral-500 leading-[1.45] dark:text-neutral-400"
							id={helpId}
						>
							When enabled, kTab can send a saved site's domain or brand name to
							macOSicons, Simple Icons, or Google's favicon service to find an
							icon. Selected images stay cached on this device. New sources are
							used when an icon is first resolved or its 14-day entry expires.
						</p>
					</div>
					<div className="inline-flex shrink-0 items-center gap-2.5 font-medium text-[12px] text-neutral-700 dark:text-neutral-300">
						<span id={switchLabelId}>Use online sources</span>
						<Switch
							aria-describedby={helpId}
							aria-labelledby={switchLabelId}
							checked={settings.enabled}
							disabled={loading || saving}
							onCheckedChange={(enabled: boolean) =>
								setSettings((current) => ({ ...current, enabled }))
							}
						/>
					</div>
				</div>

				<div className="flex min-w-0 flex-col gap-1.5">
					<label
						className="font-medium text-[12px] text-neutral-700 dark:text-neutral-300"
						htmlFor={keyInputId}
					>
						macOSicons API key (optional)
					</label>
					<Input
						id={keyInputId}
						type="password"
						autoComplete="off"
						autoCapitalize="none"
						spellCheck={false}
						value={settings.apiKey}
						disabled={loading || saving}
						aria-describedby={helpId}
						placeholder="Paste your personal API key"
						onChange={(event) =>
							setSettings((current) => ({
								...current,
								apiKey: event.currentTarget.value,
							}))
						}
					/>
				</div>

				<p className="text-[11px] text-neutral-500 leading-[1.45] dark:text-neutral-400">
					Your key stays in this browser profile and is not included in backups.
					macOSicons requests use your plan's quota; the selected icon and
					creator credit are kept for up to 29 days.
				</p>

				<div className="flex flex-wrap items-center gap-2">
					<SettingsAction
						type="submit"
						disabled={loading || saving || !changed}
					>
						{saving ? "Saving…" : "Save icon settings"}
					</SettingsAction>
					<a
						className="text-[12px] text-neutral-600 underline decoration-neutral-400/60 underline-offset-2 dark:text-neutral-300"
						href="https://macosicons.com/developers"
						target="_blank"
						rel="noreferrer"
					>
						Get a key
					</a>
				</div>
				<p className="sr-only" aria-live="polite">
					{loading
						? "Loading icon source settings."
						: "Icon source settings ready."}
				</p>
			</form>
		</SectionCard>
	);
}
