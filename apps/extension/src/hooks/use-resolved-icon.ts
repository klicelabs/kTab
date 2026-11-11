import { useEffect, useState } from "react";
import { resolveIconForDomain } from "../lib/icon-resolver";
import { getDomain, isAbsoluteHttpUrl } from "../lib/url";
import { getSvgXmlByRoute } from "../services/svgl";
import {
	enqueueIconResolution,
	ICON_CACHE_NEGATIVE_TTL_MS,
	ICON_CACHE_TTL_MS,
	type IconSource,
	type IconTreatment,
	useIconCacheStore,
} from "../stores/icon-cache-store";
import { useIconBlobUrl } from "./use-icon-blob-url";

export type ResolvedIconStatus = "svg" | "image" | "letter" | "baseline";

export interface ResolvedIconState {
	status: ResolvedIconStatus;
	/** Render target for kind "image" (absolute URL). */
	imageSrc: string | null;
	/** Render target for kind "svg" (inline XML, sanitized downstream). */
	svgXml: string | null;
	treatment: IconTreatment;
	source: IconSource | null;
	/** Natural pixel size of the source asset (0 = unknown / vector). */
	width: number;
	height: number;
	/** macOSicons attribution retained with the cached result. */
	credit?: string;
	creditUrl?: string;
	uploadedBy?: string;
}

export interface ResolvedIconOptions {
	/**
	 * The card-level favicon (card.favicon). Only a browser-captured data:
	 * URL outranks a resolved record — it is the one icon the browser itself
	 * confirmed. Any persisted http(S) favicon is a Google S2 derivation, so
	 * the resolver result wins over it.
	 */
	explicitFavicon?: string;
}

/**
 * Presentation hook for the resolved icon of a URL.
 *
 * Precedence:
 *   1. `data:` favicon (browser-confirmed capture)
 *   2. known cache record — svgl art, site icon, provider hit, negative
 *      (stale records keep rendering while a lazy re-probe refreshes them)
 *   3. baseline — the classic favicon while resolution is pending
 *      (identical look to pre-pipeline sessions, shown only on cold start)
 *
 * Demand-driven: a missing/stale record enqueues the domain into the idle
 * scheduler (throttled, concurrency-capped, single-flight per domain), so
 * mounted tiles — and only mounted tiles — trigger work.
 */
export function useResolvedIcon(
	url: string,
	options?: ResolvedIconOptions,
): ResolvedIconState {
	const explicitFavicon = options?.explicitFavicon;
	const domainKey = getDomain(url);
	// Per-key selector: sibling resolutions never re-render unrelated tiles.
	const record = useIconCacheStore((state) => state.records[domainKey] ?? null);
	const override =
		typeof explicitFavicon === "string" && explicitFavicon.startsWith("data:")
			? explicitFavicon
			: null;

	const fresh = record
		? Date.now() - record.fetchedAt <
			(record.kind === "none" ? ICON_CACHE_NEGATIVE_TTL_MS : ICON_CACHE_TTL_MS)
		: false;
	const underage = !override && !fresh;
	const blobUrl = useIconBlobUrl(
		domainKey,
		!override && record?.kind === "image" ? record.src : null,
	);

	useEffect(() => {
		if (!underage || !domainKey || !isAbsoluteHttpUrl(url)) return;
		enqueueIconResolution(domainKey, url, resolveIconForDomain);
	}, [underage, domainKey, url]);

	const route = record?.kind === "svg" ? record.src : null;
	const [svgXml, setSvgXml] = useState<string | null>(null);
	useEffect(() => {
		if (!route) {
			setSvgXml(null);
			return;
		}
		let alive = true;
		void getSvgXmlByRoute(route).then((xml) => {
			if (alive) setSvgXml(xml);
		});
		return () => {
			alive = false;
		};
	}, [route]);

	if (override) {
		return {
			status: "image",
			imageSrc: override,
			svgXml: null,
			treatment: "glyph",
			source: null,
			width: 0,
			height: 0,
		};
	}
	if (record) {
		if (record.kind === "svg") {
			return {
				status: "svg",
				imageSrc: null,
				svgXml,
				treatment: "glyph",
				source: record.source,
				width: 0,
				height: 0,
			};
		}
		if (record.kind === "image") {
			return {
				status: "image",
				imageSrc: blobUrl ?? record.src,
				svgXml: null,
				treatment: record.treatment,
				source: record.source,
				width: record.width ?? 0,
				height: record.height ?? 0,
				credit: record.credit,
				creditUrl: record.creditUrl,
				uploadedBy: record.uploadedBy,
			};
		}
		// Negative record: a deterministic letter-mark instead of a generic
		// service avatar; re-probed once the negative TTL expires.
		return {
			status: "letter",
			imageSrc: null,
			svgXml: null,
			treatment: "glyph",
			source: record.source,
			width: 0,
			height: 0,
		};
	}
	return {
		status: "baseline",
		imageSrc: explicitFavicon || null,
		svgXml: null,
		treatment: "glyph",
		source: null,
		width: 0,
		height: 0,
	};
}
