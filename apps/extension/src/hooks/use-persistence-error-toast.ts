import { useEffect } from "react";
import { toast } from "sonner";
import { subscribeToPersistHealth } from "../lib/storage";

const PERSISTENCE_ERROR_TOAST_ID = "ktab-persistence-error";

/**
 * Keep storage failures visible without adding status chrome to Settings.
 * P5-A: the toast is STICKY while persistence is broken ("failed") and
 * dismisses itself when a write lands again ("ok") — the user is never left
 * assuming a change was saved when it was not, and never stuck with a stale
 * error after the problem healed.
 */
export function usePersistenceErrorToast(): void {
	useEffect(
		() =>
			subscribeToPersistHealth((health) => {
				if (health === "failed") {
					toast.error("Changes aren't being saved", {
						id: PERSISTENCE_ERROR_TOAST_ID,
						description:
							"Recent changes exist only on this screen until saving succeeds. Free up storage if it is full.",
					});
					return;
				}
				if (health === "ok") {
					toast.dismiss(PERSISTENCE_ERROR_TOAST_ID);
				}
			}),
		[],
	);
}
