import { Switch } from "@ktab/ui/components/switch";
import { Icon } from "@ktab/ui/icons/icon";
import { useState } from "react";
import { useQuickLinkReorder } from "../../hooks/use-quick-link-reorder";
import { cn } from "../../lib/utils";
import { useSetupStore } from "../../stores/setup-store";
import type { QuickLink } from "../../types";
import { useAppearance } from "./appearance-provider";
import { QuickLinkEditorDialog } from "./quick-link-editor-dialog";
import { SectionCard } from "./settings/shared/section-card";
import { SettingRow } from "./settings/shared/setting-row";
import {
	SettingsAction,
	SettingsIconButton,
} from "./settings/shared/settings-action";
import { SettingsExpandable } from "./settings/shared/settings-expandable";
import {
	SETTINGS_FOCUS_RING,
	SETTINGS_SWITCH,
} from "./settings/shared/settings-tokens";

export function QuickLinksSettings() {
	const { isLiquid } = useAppearance();
	const { enabled, items } = useSetupStore((s) => s.settings.quickLinks);
	const update = useSetupStore((s) => s.updateQuickLinks);
	const add = useSetupStore((s) => s.addQuickLink);
	const edit = useSetupStore((s) => s.updateQuickLink);
	const remove = useSetupStore((s) => s.removeQuickLink);
	const move = useSetupStore((s) => s.moveQuickLink);
	const [expanded, setExpanded] = useState(false);
	const [editor, setEditor] = useState<{ link: QuickLink | null } | null>(null);
	const reorder = useQuickLinkReorder("vertical");
	return (
		<SectionCard className="quick-links-settings">
			<SettingRow
				label="Quick links"
				icon="link"
				tooltip="Manage the destinations above your bookmarks. Drag to reorder or use the arrow buttons."
			>
				<SettingsAction
					aria-expanded={expanded}
					aria-controls="quick-links-manager"
					onClick={() => setExpanded((value) => !value)}
				>
					Manage
				</SettingsAction>
				<Switch
					className={SETTINGS_SWITCH}
					aria-label="Show quick links"
					checked={enabled}
					onCheckedChange={(checked) => update({ enabled: checked })}
				/>
			</SettingRow>
			<SettingsExpandable expanded={expanded} label="Quick link items">
				<div id="quick-links-manager" className="px-2 pb-3">
					<p className="px-1 pb-2 text-muted-foreground text-xs">
						Drag the handle or use the arrows to change the order.
					</p>
					<ol
						className="m-0 flex list-none flex-col gap-1 p-0"
						aria-label="Quick link order"
					>
						{items.map((link, index) => (
							<li
								key={link.id}
								{...reorder.dropProps(link.id)}
								data-quick-link-id={link.id}
								data-quick-link-drop={
									reorder.dropTarget?.id === link.id
										? reorder.dropTarget.position
										: undefined
								}
								className={cn(
									"quick-link-reorder-vertical relative flex min-w-0 flex-wrap items-center gap-1 rounded-lg px-1 py-2",
									reorder.draggingId === link.id && "opacity-40",
								)}
							>
								<button
									type="button"
									{...reorder.dragProps(link.id)}
									aria-label={`Drag ${link.label} to reorder`}
									title="Drag to reorder"
									className={cn(
										"inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground active:cursor-grabbing",
										SETTINGS_FOCUS_RING,
									)}
								>
									<Icon name="grip" size={14} aria-hidden="true" />
								</button>
								<button
									type="button"
									className={cn(
										"min-w-0 flex-1 rounded-md px-1 text-left",
										SETTINGS_FOCUS_RING,
									)}
									aria-label={`Edit ${link.label}`}
									onClick={() => setEditor({ link })}
								>
									<span className="block truncate font-medium text-xs">
										{link.label}
									</span>
									<span className="block truncate text-[11px] text-muted-foreground">
										{link.url}
									</span>
								</button>
								<div className="ml-auto flex items-center">
									<SettingsIconButton
										icon="chevron-up"
										label={`Move ${link.label} up`}
										disabled={index === 0}
										onClick={() => {
											const target = items[index - 1];
											if (target) move(link.id, target.id, "before");
										}}
										className="disabled:opacity-30"
									/>
									<SettingsIconButton
										icon="chevron-down"
										label={`Move ${link.label} down`}
										disabled={index === items.length - 1}
										onClick={() => {
											const target = items[index + 1];
											if (target) move(link.id, target.id, "after");
										}}
										className="disabled:opacity-30"
									/>
									<SettingsIconButton
										icon="pencil"
										label={`Edit ${link.label}`}
										onClick={() => setEditor({ link })}
									/>
									<SettingsIconButton
										icon="trash"
										tone="danger"
										label={`Remove ${link.label}`}
										onClick={() => remove(link.id)}
									/>
								</div>
							</li>
						))}
					</ol>
					{items.length === 0 && (
						<p className="px-1 py-3 text-muted-foreground text-xs">
							No quick links yet. Add your first destination.
						</p>
					)}
					<SettingsAction
						icon="plus"
						className="mt-2"
						onClick={() => setEditor({ link: null })}
					>
						Add link
					</SettingsAction>
					<span className="sr-only" aria-live="polite">
						{reorder.announcement}
					</span>
				</div>
			</SettingsExpandable>
			<QuickLinkEditorDialog
				open={editor !== null}
				link={editor?.link ?? null}
				isLiquid={isLiquid}
				onOpenChange={(open) => {
					if (!open) setEditor(null);
				}}
				onSave={(changes) => {
					if (editor?.link) edit(editor.link.id, changes);
					else add(changes);
				}}
			/>
		</SectionCard>
	);
}
