import { useEffect, useState } from "react";
import { ext } from "../../../lib/extension-api";
import {
	DEFAULT_TAB_SWITCHER_SHORTCUT,
	eventToCombo,
	formatShortcut,
	isValidShortcut,
	normalizeShortcut,
	readTabSwitcherShortcut,
	shortcutLabel,
	TAB_SWITCHER_SHORTCUT_KEY,
	writeTabSwitcherShortcut,
} from "../../../lib/tab-switcher-shortcut";
import {
	DEFAULT_TAB_SWITCHER_TITLE_SOURCE,
	normalizeTabSwitcherTitleSource,
	readTabSwitcherTitleSource,
	type SwitcherTitleSource,
	TAB_SWITCHER_TITLE_SOURCE_KEY,
	writeTabSwitcherTitleSource,
} from "../../../lib/tab-switcher-title-source";
import { cn } from "../../../lib/utils";
import { SectionCard } from "./shared/section-card";
import { SelectRow } from "./shared/select-row";
import { SettingRow } from "./shared/setting-row";
import { SettingsIconButton } from "./shared/settings-action";
import { SettingsStatus } from "./shared/settings-feedback";
import {
	SETTINGS_FOCUS_RING,
	SETTINGS_TRIGGER,
} from "./shared/settings-tokens";

interface Feedback {
	tone: "info" | "success" | "error";
	text: string;
}

const SWITCHER_TITLE_SOURCE_OPTIONS = [
	{ value: "title", label: "Tab title" },
	{ value: "site", label: "Site name from URL" },
] as const;

/**
 * The tab switcher hotkey, remappable without leaving the extension. Chrome
 * cannot rebind a manifest command programmatically, so the key is owned by a
 * keydown listener and stored under its own local key; this row records a new
 * combo and writes it straight to storage. The live listener picks the change
 * up through storage.onChanged, so no reload is needed.
 */
export function TabSwitcherShortcut() {
	const [shortcut, setShortcut] = useState(DEFAULT_TAB_SWITCHER_SHORTCUT);
	const [titleSource, setTitleSource] = useState<SwitcherTitleSource>(
		DEFAULT_TAB_SWITCHER_TITLE_SOURCE,
	);
	const [recording, setRecording] = useState(false);
	const [feedback, setFeedback] = useState<Feedback | null>(null);

	useEffect(() => {
		let active = true;
		void readTabSwitcherShortcut().then((value) => {
			if (active) setShortcut(value);
		});
		void readTabSwitcherTitleSource().then((value) => {
			if (active) setTitleSource(value);
		});
		const onChanged = (
			changes: Record<string, { newValue?: unknown }>,
			area: string,
		) => {
			if (area !== "local") return;
			if (TAB_SWITCHER_SHORTCUT_KEY in changes) {
				setShortcut(
					normalizeShortcut(changes[TAB_SWITCHER_SHORTCUT_KEY].newValue),
				);
			}
			if (TAB_SWITCHER_TITLE_SOURCE_KEY in changes) {
				setTitleSource(
					normalizeTabSwitcherTitleSource(
						changes[TAB_SWITCHER_TITLE_SOURCE_KEY].newValue,
					),
				);
			}
		};
		ext.storage.onChanged.addListener(onChanged);
		return () => {
			active = false;
			ext.storage.onChanged.removeListener(onChanged);
		};
	}, []);

	// While armed, capture on the window in the capture phase so the combo is
	// seen before the document-level hotkey listener — stopPropagation keeps a
	// recorded Alt+Q from also opening the switcher underneath the recorder.
	useEffect(() => {
		if (!recording) return;
		const onKeyDown = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") {
				setRecording(false);
				setFeedback(null);
				return;
			}
			const combo = eventToCombo(event);
			if (!combo) return; // modifier-only: keep waiting for the base key
			if (!isValidShortcut(combo)) {
				setFeedback({
					tone: "error",
					text: "Add Ctrl, Alt or Cmd — or use a function key (F1–F24).",
				});
				return;
			}
			const value = formatShortcut(combo);
			setShortcut(value);
			setRecording(false);
			setFeedback({
				tone: "success",
				text: `Shortcut set to ${shortcutLabel(value)}.`,
			});
			void writeTabSwitcherShortcut(value);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [recording]);

	useEffect(() => {
		if (!feedback || feedback.tone === "info") return;
		const timer = setTimeout(() => setFeedback(null), 2600);
		return () => clearTimeout(timer);
	}, [feedback]);

	const startOrCancel = () => {
		if (recording) {
			setRecording(false);
			setFeedback(null);
			return;
		}
		setFeedback({
			tone: "info",
			text: "Press a new shortcut — Esc to cancel.",
		});
		setRecording(true);
	};

	const reset = () => {
		setRecording(false);
		setShortcut(DEFAULT_TAB_SWITCHER_SHORTCUT);
		setFeedback({ tone: "success", text: "Reset to Alt+Q." });
		void writeTabSwitcherShortcut(DEFAULT_TAB_SWITCHER_SHORTCUT);
	};

	const customized = shortcut !== DEFAULT_TAB_SWITCHER_SHORTCUT;
	const label = shortcutLabel(shortcut);

	return (
		<SectionCard>
			<SettingRow
				label="Tab switcher"
				icon="keyboard"
				tooltip="Opens the tab switcher over any page. Click, then press a new combo."
			>
				{customized ? (
					<SettingsIconButton
						icon="undo"
						label="Reset shortcut to Alt+Q"
						onClick={reset}
					/>
				) : null}
				<button
					type="button"
					aria-pressed={recording}
					aria-label={
						recording
							? "Recording: press the new shortcut, Escape to cancel"
							: `Tab switcher shortcut: ${label}. Activate to change.`
					}
					onClick={startOrCancel}
					onBlur={() => {
						if (recording) {
							setRecording(false);
							setFeedback(null);
						}
					}}
					className={cn(
						"inline-flex h-8 min-w-[6rem] items-center justify-center whitespace-nowrap px-3 font-medium text-xs tabular-nums tracking-tight",
						SETTINGS_TRIGGER,
						SETTINGS_FOCUS_RING,
						recording &&
							"text-[var(--klice-accent)] ring-2 ring-[var(--klice-accent)]",
					)}
				>
					{recording ? (
						<span className="inline-flex items-center gap-1.5">
							<span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
							Press keys…
						</span>
					) : (
						label
					)}
				</button>
			</SettingRow>
			{feedback ? (
				<SettingsStatus tone={feedback.tone}>{feedback.text}</SettingsStatus>
			) : null}
			<SelectRow
				label="Default title source"
				icon="text"
				tooltip="Chooses the title shown under tab switcher thumbnails."
				value={titleSource}
				options={SWITCHER_TITLE_SOURCE_OPTIONS}
				onChange={(value) => {
					const next = normalizeTabSwitcherTitleSource(value);
					setTitleSource(next);
					void writeTabSwitcherTitleSource(next);
				}}
			/>
		</SectionCard>
	);
}
