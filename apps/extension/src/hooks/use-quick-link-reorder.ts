import { type DragEvent, useState } from "react";
import { useSetupStore } from "../stores/setup-store";

const QUICK_LINK_DRAG_TYPE = "application/x-ktab-quick-link";
type DropTarget = { id: string; position: "before" | "after" };

export function useQuickLinkReorder(axis: "horizontal" | "vertical") {
	const move = useSetupStore((s) => s.moveQuickLink);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const reset = () => {
		setDraggingId(null);
		setDropTarget(null);
	};
	function position(event: DragEvent<HTMLElement>): DropTarget["position"] {
		const rect = event.currentTarget.getBoundingClientRect();
		return (
			axis === "horizontal"
				? event.clientX < rect.left + rect.width / 2
				: event.clientY < rect.top + rect.height / 2
		)
			? "before"
			: "after";
	}
	return {
		draggingId,
		dropTarget,
		announcement,
		dragProps: (id: string) => ({
			draggable: true,
			onDragStart: (event: DragEvent<HTMLElement>) => {
				event.stopPropagation();
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData(QUICK_LINK_DRAG_TYPE, id);
				event.dataTransfer.setData("text/plain", id);
				setDraggingId(id);
			},
			onDragEnd: reset,
		}),
		dropProps: (id: string) => ({
			onDragOver: (event: DragEvent<HTMLElement>) => {
				if (!event.dataTransfer.types.includes(QUICK_LINK_DRAG_TYPE)) return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = "move";
				const next = { id, position: position(event) };
				setDropTarget((current) =>
					current?.id === next.id && current.position === next.position
						? current
						: next,
				);
			},
			onDragLeave: (event: DragEvent<HTMLElement>) => {
				if (
					event.relatedTarget instanceof Node &&
					event.currentTarget.contains(event.relatedTarget)
				)
					return;
				setDropTarget((current) => (current?.id === id ? null : current));
			},
			onDrop: (event: DragEvent<HTMLElement>) => {
				const source = event.dataTransfer.getData(QUICK_LINK_DRAG_TYPE);
				if (!source) return;
				event.preventDefault();
				event.stopPropagation();
				move(source, id, position(event));
				setAnnouncement("Quick link order updated.");
				reset();
			},
		}),
	};
}
