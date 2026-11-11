import { useEffect, useState } from "react";
import {
	getCachedIconObjectUrl,
	getIconObjectUrl,
} from "../lib/icon-blob-cache";

interface HydratedIcon {
	key: string;
	url: string;
}

/**
 * Return the page-local object URL as soon as IndexedDB hydrates it. Until
 * then, keep rendering the selected remote URL so the tile never goes blank.
 */
export function useIconBlobUrl(
	domainKey: string,
	src: string | null,
): string | null {
	const key = src ? `${domainKey}\u0000${src}` : "";
	const cached = src ? getCachedIconObjectUrl(domainKey, src) : null;
	const [hydrated, setHydrated] = useState<HydratedIcon | null>(null);

	useEffect(() => {
		if (!src || !domainKey) return;
		let active = true;
		void getIconObjectUrl(domainKey, src).then((url) => {
			if (active && url) setHydrated({ key, url });
		});
		return () => {
			active = false;
		};
	}, [domainKey, key, src]);

	if (!src) return null;
	return cached ?? (hydrated?.key === key ? hydrated.url : src);
}
