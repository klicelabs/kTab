/**
 * Icon resolution pipeline for the launcher surfaces.
 *
 * Each domain resolves ONCE through a quality-first ladder, and the result is
 * persisted in the icon cache store (see stores/icon-cache-store.ts) so later
 * sessions render instantly:
 *
 *   1. macOSicons (opt-in) — personal API key, native artwork and attribution.
 *   2. Simple Icons + Google S2 (opt-in) — the requested remote fallback chain.
 *   3. Site app icon      — the site's OWN app icon: an apple-touch-icon or
 *                            a Web App Manifest "any" icon at app scale
 *                            (≥96px). Opaque app-scale squares paint
 *                            edge-to-edge, which is the home-screen look.
 *                            Manifest "monochrome" entries are alpha masks
 *                            (the spec discards their colour) and are never
 *                            shown; "maskable" entries rank just below.
 *   4. SVGL brand art     — curated vector marks (kind "svg") for brands
 *                            that ship no app icon of their own.
 *   5. Site glyph          — vector logo, small raster, /favicon.ico.
 *   6. DuckDuckGo ip3      — fallback when online sources are disabled.
 *   7. Negative record     — letter-mark fallback stays deterministic, and a
 *                            dead-end site is never re-probed on every open.
 *
 * Every network step fails independently. A dead network yields NO record
 * rather than a fake negative, so the ladder re-runs on a later session —
 * but an alive domain that refuses the document still reaches rung 3 and
 * the provider verdict before any negative is written. Divided by design
 * from the Turborepo's apps/web backend — this runs in the newtab page
 * (install-time host permissions cover the cross-origin fetches it needs).
 */

import {
	getMacOSiconsSettings,
	type MacOSiconsHit,
	searchMacOSicons,
} from "../services/macosicons";
import { fetchAllSvgs } from "../services/svgl";
import {
	type IconSource,
	type IconTreatment,
	useIconCacheStore,
} from "../stores/icon-cache-store";
import type { SVGLItem, SVGLThemeOptions } from "../types";
import { SITE_URL_TO_SVGL } from "./svgl-mapping";
import { getDomain, isAbsoluteHttpUrl } from "./url";

/* ── constants ─────────────────────────────────────────────────────────────── */

export const HTML_PROBE_CAP_BYTES = 120 * 1024;
export const HTML_PROBE_TIMEOUT_MS = 8_000;
export const MANIFEST_TIMEOUT_MS = 4_000;
export const MANIFEST_CAP_BYTES = 64 * 1024;
export const ASSET_TIMEOUT_MS = 6_000;
/** Full-bleed classification needs a source with real pixels to judge. */
export const FULL_PROBE_MIN_SIZE = 48;
/**
 * App-scale threshold. Below this a raster is a FAVICON, never an app tile:
 * painting a 32×32 icon edge-to-edge reads as a stretched blur, not an app
 * icon. 96px is the smallest asset that still carries the site's own artwork
 * (apple-touch-icon 120/152/180, manifest 96/128) at a usable resolution.
 */
export const APP_ICON_MIN_SIZE = 96;
/** Edge pixels ≥ this opacity ratio paint edge-to-edge (alpha sampling). */
export const FULL_EDGE_RATIO = 0.8;
/** DuckDuckGo serves nothing below a 16px frame; guard against placeholder junk. */
export const MIN_PROVIDER_SIZE = 16;
/** How many app-scale candidates may be decoded per domain (cost bound). */
export const MAX_APP_CANDIDATE_PROBES = 3;

/* Scores: quality tiers, not a rigid order. The best-scoring DECODED
   candidate wins regardless of which rung produced it. */
export const SCORE_APPLE_TOUCH = 90;
export const SCORE_MANIFEST_LARGE = 86;
export const SCORE_MANIFEST_MASKABLE = 84;
export const SCORE_REL_SVG = 82;
export const SCORE_MANIFEST_MEDIUM = 74;
export const SCORE_REL_LARGE = 70;
export const SCORE_MANIFEST_SMALL = 58;
export const SCORE_REL_MEDIUM = 60;
export const SCORE_DIRECT_ICO = 48;
export const SCORE_REL_SMALL = 45;
/**
 * `apple-touch-icon*` files are the site's own APP ICON by web convention
 * (that is what iOS puts on the home screen). They outrank a larger but
 * generic manifest raster — same tier, better intent.
 */
export const SCORE_APP_ICON_NAME_BONUS = 2;

/* ── types ─────────────────────────────────────────────────────────────────── */

/**
 * Web App Manifest icon intent (W3C Web App Manifest, `icons[].purpose`).
 *
 *   any        the site's real icon — this is the app-icon candidate.
 *   maskable   artwork designed for an OS mask: the outer band is padding,
 *              so it must never be painted edge-to-edge.
 *   monochrome an ALPHA MASK only — the spec says the colour is discarded
 *              and the alpha reused as a mask. Rendering it as an image
 *              yields a flat white/transparent mark, never the brand.
 */
export type IconPurpose = "any" | "maskable" | "monochrome";

export interface ProbeCandidate {
	source: IconSource;
	/** Absolute http(s) URL resolved against the page/base/manifest URL. */
	href: string;
	/** Best-known pixel size (0 = unknown). */
	width: number;
	/** Declared SVG (inline rendering, no raster probe needed). */
	isSvg: boolean;
	/** Manifest intent. HTML links are always "any". */
	purpose: IconPurpose;
	score: number;
}

export interface ProbePlan {
	candidates: ProbeCandidate[];
	manifestHref: string | null;
}

export interface DecodedAsset {
	naturalWidth: number;
	naturalHeight: number;
	/** Fraction of the cover-fit 32×32 edge ring with alpha > 40/255. */
	opaqueEdgeRatio: number;
}

/**
 * Probe verdict.
 *
 *   quality "app"   the asset is an opaque app-scale square — it paints
 *                   edge-to-edge and reads as a real launcher icon.
 *   quality "glyph" a mark (transparent artwork or a favicon-scale raster)
 *                   that stays centered on the tile's neutral face.
 */
export type ProbeOutcome =
	| {
			kind: "resolved";
			source: IconSource;
			href: string;
			treatment: IconTreatment;
			quality: "app" | "glyph";
			/** Natural pixel size of the asset (0 = unknown / vector). */
			width: number;
			height: number;
			credit?: string;
			creditUrl?: string;
			uploadedBy?: string;
	  }
	| { kind: "missed" } /* page reachable, nothing usable anywhere */
	| { kind: "unreachable" }; /* network refused — record NOTHING */

export type ProviderOutcome =
	| {
			kind: "resolved";
			href: string;
			treatment: IconTreatment;
			width: number;
			height: number;
	  }
	| { kind: "missed" } /* real 404 — DDG verified the domain has no icon */
	| { kind: "unreachable" };

const DOMAIN_BRAND_NAMES: Record<string, string> = {
	"chat.openai.com": "ChatGPT",
	"chatgpt.com": "ChatGPT",
	"discord.com": "Discord",
	"docs.google.com": "Google Docs",
	"drive.google.com": "Google Drive",
	"figma.com": "Figma",
	"github.com": "GitHub",
	"linear.app": "Linear",
	"mail.google.com": "Gmail",
	"m.youtube.com": "YouTube",
	"notion.so": "Notion",
	"reddit.com": "Reddit",
	"slack.com": "Slack",
	"open.spotify.com": "Spotify",
	"twitter.com": "X",
	"x.com": "X",
	"youtu.be": "YouTube",
};

const SIMPLE_ICON_SLUGS: Record<string, string> = {
	"chat.openai.com": "openai",
	"chatgpt.com": "openai",
	"discord.com": "discord",
	"docs.google.com": "googledocs",
	"drive.google.com": "googledrive",
	"figma.com": "figma",
	"github.com": "github",
	"linear.app": "linear",
	"mail.google.com": "gmail",
	"m.youtube.com": "youtube",
	"notion.so": "notion",
	"reddit.com": "reddit",
	"slack.com": "slack",
	"open.spotify.com": "spotify",
	"twitter.com": "x",
	"x.com": "x",
	"youtu.be": "youtube",
};

const MULTIPART_PUBLIC_SUFFIXES = new Set([
	"co.uk",
	"com.ar",
	"com.au",
	"com.br",
	"com.cn",
	"com.mx",
	"com.sg",
	"co.jp",
	"co.nz",
	"co.za",
]);

function rootDomainLabel(domainKey: string): string {
	const labels = domainKey.toLowerCase().replace(/^www\./, "").split(".");
	if (labels.length < 2) return labels[0] ?? "";
	const suffix = labels.slice(-2).join(".");
	const index = labels.length - (MULTIPART_PUBLIC_SUFFIXES.has(suffix) ? 3 : 2);
	return labels[index] ?? labels[0] ?? "";
}

/** Brand label used by both macOSicons search and the Simple Icons fallback. */
export function iconBrandName(domainKey: string): string {
	const domain = domainKey.toLowerCase().replace(/^www\./, "");
	return (
		DOMAIN_BRAND_NAMES[domain] ??
		rootDomainLabel(domain)
			.split(/[-_]+/)
			.filter(Boolean)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" ")
	);
}

/** Simple Icons CDN URL for a domain's normalized brand slug. */
export function simpleIconsUrl(domainKey: string): string | null {
	const domain = domainKey.toLowerCase().replace(/^www\./, "");
	const slug = SIMPLE_ICON_SLUGS[domain] ?? rootDomainLabel(domain);
	if (!/^[a-z0-9-]+$/.test(slug)) return null;
	return `https://cdn.simpleicons.org/${encodeURIComponent(slug)}`;
}

/** Google S2's high-resolution favicon endpoint used as the final fallback. */
export function googleHQFaviconUrl(domainKey: string, size = 128): string | null {
	const domain = domainKey.toLowerCase().replace(/^www\./, "");
	if (!domain || /[^a-z0-9.-]/.test(domain)) return null;
	const url = new URL("https://www.google.com/s2/favicons");
	url.searchParams.set("domain", domain);
	url.searchParams.set("sz", String(size));
	return url.toString();
}

/** Primary external rung. The API key is read from this user's local settings. */
export async function probeMacOSicons(
	domainKey: string,
	measure: (assetUrl: string) => Promise<DecodedAsset | null> = measureAsset,
): Promise<(Extract<ProbeOutcome, { kind: "resolved" }> & { hit: MacOSiconsHit }) | null> {
	const settings = await getMacOSiconsSettings();
	if (!settings.enabled || !settings.apiKey || !domainKey) return null;
	const hit = await searchMacOSicons(iconBrandName(domainKey), settings.apiKey);
	if (!hit) return null;
	const decoded = await measure(hit.lowResPngUrl);
	if (!decoded) return null;
	return {
		kind: "resolved",
		source: "macosicons",
		href: hit.lowResPngUrl,
		// macOSicons assets already carry their app icon silhouette.
		treatment: "full",
		quality: "app",
		width: decoded.naturalWidth,
		height: decoded.naturalHeight,
		hit,
	};
}

/** Resolve a Simple Icons CDN mark when the provider setting is enabled. */
export async function probeSimpleIcons(
	domainKey: string,
	measure: (assetUrl: string) => Promise<DecodedAsset | null> = measureAsset,
): Promise<ProviderOutcome> {
	const href = simpleIconsUrl(domainKey);
	if (!href) return { kind: "missed" };
	const decoded = await measure(href);
	if (!decoded) return { kind: "missed" };
	return {
		kind: "resolved",
		href,
		treatment: "glyph",
		width: decoded.naturalWidth,
		height: decoded.naturalHeight,
	};
}

/** Resolve Google's 128px favicon as the final online provider fallback. */
export async function probeProviderGoogle(
	domainKey: string,
	measure: (assetUrl: string) => Promise<DecodedAsset | null> = measureAsset,
): Promise<ProviderOutcome> {
	const href = googleHQFaviconUrl(domainKey);
	if (!href) return { kind: "missed" };
	const decoded = await measure(href);
	if (!decoded) return { kind: "missed" };
	if (
		Math.min(decoded.naturalWidth, decoded.naturalHeight) < MIN_PROVIDER_SIZE
	)
		return { kind: "missed" };
	return {
		kind: "resolved",
		href,
		treatment: "glyph",
		width: decoded.naturalWidth,
		height: decoded.naturalHeight,
	};
}

/* ── pure helpers (unit-tested) ────────────────────────────────────────────── */

/** Parse a `sizes` attribute ("192x192", "512x512 256x256", "any") → max width. */
export function parseSizes(raw: string | null | undefined): number {
	if (!raw) return 0;
	let best = 0;
	for (const token of raw.trim().split(/\s+/)) {
		if (!token || token.toLowerCase() === "any") continue;
		const dimensions = token.toLowerCase().split("x");
		const width = Number.parseInt(dimensions[0] ?? "", 10);
		if (Number.isFinite(width) && width > best) best = width;
	}
	return best;
}

/** Parse a manifest `purpose` value. "any" wins over "maskable" when both. */
export function parsePurpose(raw: unknown): IconPurpose {
	const value = typeof raw === "string" ? raw.toLowerCase() : "";
	if (value.includes("any")) return "any";
	if (value.includes("maskable")) return "maskable";
	if (value.includes("monochrome")) return "monochrome";
	return "any";
}

/**
 * Family key of an asset URL: the same artwork published at several sizes
 * (apple-touch-icon-57x57 … apple-touch-icon-256x256) shares one key.
 *
 * Sites publish a LOT of these (Vercel declares ten), and every one of them
 * would otherwise burn a decode budget slot before the ladder ever reaches
 * the real app icon in the manifest. Probing the largest member of each
 * family is enough — they are the same picture.
 */
export function assetFamilyKey(href: string): string {
	try {
		const path = new URL(href).pathname;
		const name = path.split("/").filter(Boolean).pop() ?? path;
		return name
			.replace(/[-_]?\d{2,4}x\d{2,4}.*$/i, "")
			.replace(/\.(png|jpe?g|webp|avif|svg|ico|gif)$/i, "")
			.toLowerCase();
	} catch {
		return href;
	}
}

/**
 * Score one candidate by quality tier.
 *
 * Purpose-aware (W3C Web App Manifest): a `monochrome` entry is an alpha
 * mask, not artwork — it can never be the icon we show, so it scores 0 and
 * is never measured. `maskable` artwork is padded for an OS mask, so it
 * ranks just under a real "any" icon of the same size.
 */
export function scoreCandidate(
	source: IconSource,
	width: number,
	isSvg: boolean,
	purpose: IconPurpose = "any",
	href?: string,
): number {
	if (purpose === "monochrome") return 0;
	const base = baseScore(source, width, isSvg, purpose);
	// `apple-touch-icon*` files are the site's own APP ICON by web
	// convention (that is what iOS puts on the home screen), so they
	// outrank a larger but generic manifest raster — same tier, better
	// intent.
	const appNameBonus =
		href && /apple-touch-icon/i.test(href) ? SCORE_APP_ICON_NAME_BONUS : 0;
	return base + appNameBonus;
}

function baseScore(
	source: IconSource,
	width: number,
	isSvg: boolean,
	purpose: IconPurpose,
): number {
	if (source === "shadow-touch") return SCORE_APPLE_TOUCH;
	if (source === "manifest") {
		if (isSvg) return SCORE_REL_SVG; // declared-any vector = same quality plate
		if (purpose === "maskable") {
			return width >= 192
				? SCORE_MANIFEST_MASKABLE
				: width >= 96
					? SCORE_MANIFEST_MEDIUM
					: SCORE_MANIFEST_SMALL;
		}
		if (width >= 192) return SCORE_MANIFEST_LARGE;
		if (width >= 96) return SCORE_MANIFEST_MEDIUM;
		return SCORE_MANIFEST_SMALL;
	}
	if (source === "rel-icon") {
		if (isSvg) return SCORE_REL_SVG;
		if (width >= 96) return SCORE_REL_LARGE;
		if (width >= 32) return SCORE_REL_MEDIUM;
		return SCORE_REL_SMALL;
	}
	return SCORE_DIRECT_ICO; // "probe": the direct favicon.ico rung
}

/**
 * Composition class from decode measurements (or declared shape):
 * favicon-scale rasters stay centered glyphs; app-scale opaque squares paint
 * edge-to-edge inside the squircle (iOS look); transparent marks stay glyphs.
 */
export function interpretTreatment(decoded: DecodedAsset): IconTreatment {
	const width = Math.min(decoded.naturalWidth, decoded.naturalHeight);
	if (width < APP_ICON_MIN_SIZE) return "glyph";
	return decoded.opaqueEdgeRatio >= FULL_EDGE_RATIO ? "full" : "glyph";
}

/**
 * Extraction from an already-parsed HTML document. Pure apart from reading
 * the document tree: the fetch, parser and manifest call live outside.
 */
export function extractSiteIconCandidates(
	doc: Document,
	baseUrl: string,
): ProbePlan {
	const baseHref = doc.querySelector("base[href]")?.getAttribute("href");
	const base = resolveAssetHref(baseHref, baseUrl) ?? baseUrl;

	const candidates: ProbeCandidate[] = [];
	const seen = new Set<string>();
	let manifestHref: string | null = null;

	const push = (
		source: IconSource,
		rawHref: string | null,
		width: number,
		isSvg: boolean,
	): void => {
		const href = resolveAssetHref(rawHref, base);
		if (!href || seen.has(href)) return;
		seen.add(href);
		candidates.push({
			source,
			href,
			width,
			isSvg,
			purpose: "any",
			score: scoreCandidate(source, width, isSvg, "any", href),
		});
	};

	for (const link of doc.querySelectorAll("link[href]")) {
		const relTokens = (link.getAttribute("rel") ?? "")
			.toLowerCase()
			.split(/[\s,]+/)
			.filter(Boolean);
		const href = link.getAttribute("href");
		if (relTokens.includes("apple-touch-icon")) {
			push("shadow-touch", href, parseSizes(link.getAttribute("sizes")), false);
			continue;
		}
		if (relTokens.includes("manifest")) {
			manifestHref ??= resolveAssetHref(href, base);
			continue;
		}
		if (relTokens.includes("icon")) {
			// rel="shortcut icon" arrives as ["shortcut","icon"]; bare
			// "shortcut" is noise and must not register on its own.
			const isSvg = isSvgIconLink(link, href);
			push("rel-icon", href, parseSizes(link.getAttribute("sizes")), isSvg);
		}
	}

	return { candidates, manifestHref };
}

/** Build manifest-icon candidates from a fetched Web App Manifest body. */
export function manifestCandidates(
	manifestUrl: string,
	text: string,
): ProbeCandidate[] {
	let manifest: unknown;
	try {
		manifest = JSON.parse(text);
	} catch {
		return [];
	}
	const icons = (manifest as { icons?: unknown }).icons;
	if (!Array.isArray(icons)) return [];
	const candidates: ProbeCandidate[] = [];
	const seen = new Set<string>();
	for (const icon of icons) {
		const src = (icon as { src?: unknown }).src;
		if (typeof src !== "string" || !src) continue;
		const href = resolveAssetHref(src, manifestUrl);
		if (!href || seen.has(href)) continue;
		seen.add(href);
		const width = parseSizes(
			(icon as { sizes?: unknown }).sizes as string | null,
		);
		const type =
			((icon as { type?: unknown }).type as string | undefined) ?? "";
		const isSvg = type.toLowerCase().includes("svg");
		const purpose = parsePurpose(
			(icon as { purpose?: unknown }).purpose as string | undefined,
		);
		candidates.push({
			source: "manifest",
			href,
			width,
			isSvg,
			purpose,
			score: scoreCandidate("manifest", width, isSvg, purpose, href),
		});
	}
	return candidates.sort((a, b) => b.width - a.width);
}

/* ── runtime measurement (Chromium/Gecko only, never in tests) ─────────────── */

function resolveAssetHref(
	rawHref: string | null | undefined,
	baseUrl: string,
): string | null {
	if (!rawHref) return null;
	try {
		const url = new URL(rawHref, baseUrl);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url.toString();
	} catch {
		return null;
	}
}

function isSvgIconLink(link: Element, href: string | null): boolean {
	const type = (link.getAttribute("type") ?? "").toLowerCase();
	if (type.includes("svg")) return true;
	if (href && /\.svg(\?|#|$)/i.test(href.trim())) return true;
	const sizes = link.getAttribute("sizes");
	return sizes?.toLowerCase() === "any";
}

/** Content-capped GET: idle-slot friendly, aborts when the budget runs out. */
type TextCapResult =
	| { state: "ok"; text: string; url: string }
	| { state: "refused" } /* server answered, status not ok — domain IS alive */
	| { state: "offline" }; /* network failure or abort — no verdict possible */

async function fetchTextCapped(
	url: string,
	capBytes: number,
	timeoutMs: number,
	accept?: string,
): Promise<TextCapResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			signal: controller.signal,
			redirect: "follow",
			...(accept ? { headers: { Accept: accept } } : {}),
		});
		if (!res.ok) return { state: "refused" };
		if (!res.body) {
			const text = await res.text();
			return { state: "ok", text: text.slice(0, capBytes), url: res.url };
		}
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let text = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
			if (text.length >= capBytes) {
				text = text.slice(0, capBytes);
				void reader.cancel().catch(() => {});
				break;
			}
		}
		return { state: "ok", text, url: res.url };
	} catch {
		return { state: "offline" };
	} finally {
		clearTimeout(timer);
	}
}

function parseIntoDocument(html: string): Document | null {
	if (typeof DOMParser === "undefined") return null;
	try {
		const doc = new DOMParser().parseFromString(html, "text/html");
		return doc.body ? doc : null;
	} catch {
		return null;
	}
}

/**
 * Fetch an image and measure its composition: natural size + opaque edge
 * ratio of a cover-fit 32×32 ring. This is the ONLY place that touches
 * pixels: bytes ride a fetch→blob→objectURL image so the canvas stays
 * untaintable under MV3 host permissions, and classification happens once
 * (at probe time) instead of at render.
 */
async function measureAsset(url: string): Promise<DecodedAsset | null> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);
		let blob: Blob;
		try {
			const res = await fetch(url, { signal: controller.signal });
			if (!res.ok) return null;
			blob = await res.blob();
		} finally {
			clearTimeout(timer);
		}
		if (blob.size > 2 * 1024 * 1024) return null; // icons are tiny; giant payloads are social meta images
		const objectUrl = URL.createObjectURL(blob);
		try {
			const image = await loadImage(objectUrl);
			if (image.naturalWidth === 0 || image.naturalHeight === 0) return null;
			const SIZE = 32;
			const canvas = document.createElement("canvas");
			canvas.width = SIZE;
			canvas.height = SIZE;
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) return null;
			try {
				ctx.drawImage(image, 0, 0, SIZE, SIZE);
				const data = ctx.getImageData(0, 0, SIZE, SIZE);
				let edgePixels = 0;
				let opaquePixels = 0;
				for (let y = 0; y < SIZE; y += 1) {
					for (let x = 0; x < SIZE; x += 1) {
						const isEdge =
							x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1;
						if (!isEdge) continue;
						edgePixels += 1;
						if ((data.data[y * SIZE * 4 + x * 4 + 3] ?? 0) > 40) {
							opaquePixels += 1;
						}
					}
				}
				if (edgePixels === 0) return null;
				return {
					naturalWidth: image.naturalWidth,
					naturalHeight: image.naturalHeight,
					opaqueEdgeRatio: opaquePixels / edgePixels,
				};
			} finally {
				canvas.width = 0;
				canvas.height = 0;
			}
		} finally {
			URL.revokeObjectURL(objectUrl);
		}
	} catch {
		return null;
	}
}

function loadImage(objectUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		const timer = setTimeout(() => {
			image.onload = null;
			image.onerror = null;
			reject(new Error("icon decode timeout"));
		}, ASSET_TIMEOUT_MS);
		image.onload = () => {
			clearTimeout(timer);
			resolve(image);
		};
		image.onerror = () => {
			clearTimeout(timer);
			reject(new Error("icon decode failed"));
		};
		image.src = objectUrl;
	});
}

/* ── ladder rungs ──────────────────────────────────────────────────────────── */

/**
 * SVGL rung: curated vector art. Matches by the item's own site URL
 * hostname (the index's canonical identity), backed by the curated
 * hostname→title map for search engines and recommended sites. Zone rules:
 * prefer the dark route (dashboard canvas), matching getSvgXml's semantics.
 */
export async function findSvgRoute(url: string): Promise<string | null> {
	try {
		const items = await fetchAllSvgs();
		if (!items.length) return null;
		const domain = getDomain(url);
		if (!domain) return null;
		const item =
			findItemByHostname(items, domain) ??
			itemIdByTitle(items, SITE_URL_TO_SVGL[domain]);
		if (!item) return null;
		return pickRoute(item);
	} catch {
		return null; // index fetch failed — ladder continues without SVG
	}
}

function findItemByHostname(
	items: SVGLItem[],
	domain: string,
): SVGLItem | null {
	for (const item of items) {
		const url = item.url;
		if (!url) continue;
		let hostname = "";
		let path = "";
		try {
			const parsed = new URL(url);
			hostname = parsed.hostname.replace(/^www\./, "");
			path = parsed.pathname;
		} catch {
			continue;
		}
		if (hostname !== domain && !domain.endsWith(`.${hostname}`)) continue;
		// Only the brand's ROOT page identifies the brand itself. Without
		// this, google.com/drive or google.com/maps would hijack google.com
		// (the SVGL index lists every product under the same hostname).
		if (path && path !== "/") continue;
		return item;
	}
	return null;
}

function itemIdByTitle(
	items: SVGLItem[],
	title: string | undefined,
): SVGLItem | null {
	if (!title) return null;
	const needle = title.toLowerCase();
	return items.find((item) => item.title.toLowerCase() === needle) ?? null;
}

function pickRoute(item: SVGLItem): string | null {
	const raw = (item as SVGLItem).route;
	if (typeof raw === "string" && raw) return raw;
	const themed = raw as SVGLThemeOptions;
	if (themed && typeof themed === "object") {
		return themed.dark || themed.light || null;
	}
	return null;
}

/** Rung 2: HTML probe with manifest/apple-touch/rel scoring + decode verify. */
export async function probeSiteIcons(
	url: string,
	measure: (assetUrl: string) => Promise<DecodedAsset | null> = measureAsset,
): Promise<ProbeOutcome> {
	const page = await fetchTextCapped(
		url,
		HTML_PROBE_CAP_BYTES,
		HTML_PROBE_TIMEOUT_MS,
		"text/html,application/xhtml+xml",
	);
	if (page.state === "offline") {
		return { kind: "unreachable" };
	}
	if (page.state === "refused") {
		// The domain is alive (it answered), but the document isn't there
		// (404/500). Rung 3's origin favicon often still exists, so try it
		// and let the provider adjudicate instead of discarding the session.
		return await directFaviconRun(url, measure);
	}
	const doc = parseIntoDocument(page.text);
	if (!doc) {
		return { kind: "unreachable" }; // half-body — retried next session
	}
	const { candidates, manifestHref } = extractSiteIconCandidates(
		doc,
		page.url || url,
	);

	let list = candidates;
	// The manifest is the richest source of app icons (GitHub ships its whole
	// icon set ONLY there), so it is always consulted — not only when the
	// document happens to declare an apple-touch icon.
	if (manifestHref) {
		const manifest = await fetchTextCapped(
			manifestHref,
			MANIFEST_CAP_BYTES,
			MANIFEST_TIMEOUT_MS,
			"application/manifest+json, application/json",
		);
		if (manifest.state === "ok") {
			const parsed = manifestCandidates(
				manifest.url || manifestHref,
				manifest.text,
			);
			list = [...list, ...parsed];
		}
	}

	if (list.length > 0) {
		list.sort((a, b) => b.score - a.score || b.width - a.width);
		// Monochrome entries are alpha masks (spec: colour is discarded) —
		// they can never be the icon we show.
		const usable = list.filter((c) => c.score > 0);

		// App-scale candidates are DECODED, best first and bounded: only
		// pixels can tell an app tile from a transparent logo (YouTube
		// declares a 512px monochrome mask that must never be shown, and a
		// 512px transparent mark that is not an app icon either). Anything
		// smaller than APP_ICON_MIN_SIZE is a favicon by definition and is
		// never decoded.
		const appScale = usable.filter(
			(c) => !c.isSvg && (c.width === 0 || c.width >= APP_ICON_MIN_SIZE),
		);
		let appHit: ProbeCandidate | null = null;
		let glyphHit: {
			candidate: ProbeCandidate;
			width: number;
			height: number;
		} | null = null;
		let probes = 0;
		// One decode per artwork family: a site that publishes ten sizes of
		// the same apple-touch icon must not spend the whole budget there.
		const probedFamilies = new Set<string>();
		for (const candidate of appScale) {
			if (probes >= MAX_APP_CANDIDATE_PROBES) break;
			const family = assetFamilyKey(candidate.href);
			if (probedFamilies.has(family)) continue;
			probedFamilies.add(family);
			probes += 1;
			const decoded = await measure(candidate.href);
			if (!decoded) continue; // broken-but-declared link → next candidate
			if (interpretTreatment(decoded) === "full") {
				appHit = candidate;
				glyphHit = {
					candidate,
					width: decoded.naturalWidth,
					height: decoded.naturalHeight,
				};
				break; // best possible outcome — stop decoding
			}
			// A transparent app-scale asset is still a usable mark: keep it
			// as the glyph fallback while looking for a real app tile.
			glyphHit ??= {
				candidate,
				width: decoded.naturalWidth,
				height: decoded.naturalHeight,
			};
		}

		if (appHit && glyphHit) {
			return {
				kind: "resolved",
				source: appHit.source,
				href: appHit.href,
				treatment: "full",
				quality: "app",
				width: glyphHit.width,
				height: glyphHit.height,
			};
		}

		// Vector marks: crisp at any size, never an app tile.
		const svgHit = usable.find((c) => c.isSvg);
		if (svgHit) {
			return {
				kind: "resolved",
				source: svgHit.source,
				href: svgHit.href,
				treatment: "glyph",
				quality: "glyph",
				width: 0,
				height: 0,
			};
		}
		if (glyphHit) {
			return {
				kind: "resolved",
				source: glyphHit.candidate.source,
				href: glyphHit.candidate.href,
				treatment: "glyph",
				quality: "glyph",
				width: glyphHit.width,
				height: glyphHit.height,
			};
		}
		// Nothing app-scale decoded: a small raster is still a favicon and
		// is used as a glyph without spending a decode on it. Its declared
		// size is its natural size.
		const small = usable.find((c) => !c.isSvg && c.width > 0);
		if (small) {
			return {
				kind: "resolved",
				source: small.source,
				href: small.href,
				treatment: "glyph",
				quality: "glyph",
				width: small.width,
				height: small.width,
			};
		}
	}

	// Rung 3: the bare /favicon.ico path, for sites that declare no links.
	return await directFaviconRun(page.url || url, measure);
}

/** Rung 3: measure the well-known `/favicon.ico` at the origin. */
async function directFaviconRun(
	baseUrl: string,
	measure: (assetUrl: string) => Promise<DecodedAsset | null>,
): Promise<ProbeOutcome> {
	try {
		const origin = new URL(baseUrl).origin;
		const direct = await measure(`${origin}/favicon.ico`);
		if (direct) {
			const treatment = interpretTreatment(direct);
			return {
				kind: "resolved",
				source: "probe",
				href: `${origin}/favicon.ico`,
				treatment,
				quality: treatment === "full" ? "app" : "glyph",
				width: direct.naturalWidth,
				height: direct.naturalHeight,
			};
		}
	} catch {
		// fall through to the provider rung
	}
	return { kind: "missed" };
}

/**
 * Rung 4: DuckDuckGo's icon service. Unlike Google S2 (which returns a
 * generic image with HTTP 200 for unknown domains), a 404 here is a REAL
 * negative, so the ladder can stop and record a deterministic letter-mark.
 */
export async function probeProviderDdg(
	domainKey: string,
	measure: (assetUrl: string) => Promise<DecodedAsset | null> = measureAsset,
): Promise<ProviderOutcome> {
	const endpoint = `https://icons.duckduckgo.com/ip3/${encodeURI(domainKey)}.ico`;
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);
		let href: string | null = null;
		try {
			const res = await fetch(endpoint, { signal: controller.signal });
			if (res.status === 404) return { kind: "missed" };
			if (res.ok) href = endpoint;
		} finally {
			clearTimeout(timer);
		}
		if (!href) return { kind: "unreachable" };
		const decoded = await measure(href);
		if (!decoded) return { kind: "missed" };
		if (
			Math.min(decoded.naturalWidth, decoded.naturalHeight) < MIN_PROVIDER_SIZE
		) {
			return { kind: "missed" };
		}
		return {
			kind: "resolved",
			href,
			treatment: interpretTreatment(decoded),
			width: decoded.naturalWidth,
			height: decoded.naturalHeight,
		};
	} catch {
		return { kind: "unreachable" };
	}
}

/* ── top-level resolve (wired into the idle scheduler) ─────────────────────── */

/**
 * Full ladder for one domain. Writes at most one record:
 * resolved (svg/image), negative ("none") — or nothing at all when the
 * network is unreachable, so the next session retries instead of caching a
 * false negative.
 *
 * Order of preference (the "app icon" principle):
 *
 *   1. the SITE'S OWN app icon — an opaque app-scale square (apple-touch
 *      icon / manifest "any" icon). This is the asset iOS/Android actually
 *      put on a home screen, so it is the one that reads as a real app.
 *   2. curated brand art (SVGL) — a crisp vector mark, better than a
 *      favicon-scale raster, used when the site ships no app icon.
 *   3. the site's own glyph (vector logo, small raster, /favicon.ico).
 *   4. the provider (DuckDuckGo) as a last icon source.
 *   5. a deterministic letter-mark when the provider verifies the miss.
 */
export async function resolveIconForDomain(
	domainKey: string,
	url: string,
	measure: (assetUrl: string) => Promise<DecodedAsset | null> = measureAsset,
): Promise<void> {
	if (!domainKey || !isAbsoluteHttpUrl(url)) return;
	const { model } = useIconCacheStore.getState();
	const fetchedAt = Date.now();
	const onlineSources = await getMacOSiconsSettings();

	// macOSicons has first choice only after the user enables online sources
	// and supplies their own key. The API's terms prohibit a shared key in an
	// end-user extension.
	if (onlineSources.enabled && onlineSources.apiKey) {
		const macos = await probeMacOSicons(domainKey, measure);
		if (macos) {
			model(domainKey, {
				kind: "image",
				source: "macosicons",
				src: macos.href,
				treatment: macos.treatment,
				width: macos.width,
				height: macos.height,
				credit: macos.hit.credit,
				creditUrl: macos.hit.creditUrl,
				uploadedBy: macos.hit.uploadedBy,
				fetchedAt,
			});
			return;
		}
	}

	// The opt-in remote fallback chain is ordered explicitly: Simple Icons,
	// then Google's high-resolution favicon endpoint.
	if (onlineSources.enabled) {
		const simple = await probeSimpleIcons(domainKey, measure);
		if (simple.kind === "resolved") {
			model(domainKey, {
				kind: "image",
				source: "simple-icons",
				src: simple.href,
				treatment: simple.treatment,
				width: simple.width,
				height: simple.height,
				fetchedAt,
			});
			return;
		}

		const google = await probeProviderGoogle(domainKey, measure);
		if (google.kind === "resolved") {
			model(domainKey, {
				kind: "image",
				source: "google-favicon",
				src: google.href,
				treatment: google.treatment,
				width: google.width,
				height: google.height,
				fetchedAt,
			});
			return;
		}
	}

	// Keep the original local and site-owned resolver as the final fallback.
	const probe = await probeSiteIcons(url, measure);
	if (probe.kind === "unreachable" && !onlineSources.enabled) return;
	if (probe.kind === "resolved" && probe.quality === "app") {
		model(domainKey, {
			kind: "image",
			source: probe.source,
			src: probe.href,
			treatment: probe.treatment,
			width: probe.width,
			height: probe.height,
			fetchedAt,
		});
		return;
	}

	// Rung 2 — curated brand art. A vector mark beats a favicon-scale
	// raster, so it outranks the probe's glyph tier.
	const route = await findSvgRoute(url);
	if (route) {
		model(domainKey, {
			kind: "svg",
			source: "svgl",
			src: route,
			treatment: "glyph",
			width: 0,
			height: 0,
			fetchedAt,
		});
		return;
	}

	// Site-owned glyph (vector logo / small raster / ico).
	if (probe.kind === "resolved") {
		model(domainKey, {
			kind: "image",
			source: probe.source,
			src: probe.href,
			treatment: probe.treatment,
			width: probe.width,
			height: probe.height,
			fetchedAt,
		});
		return;
	}

	// DuckDuckGo remains the final provider with a verifiable miss (404).
	const provider = await probeProviderDdg(domainKey, measure);
	if (provider.kind === "resolved") {
		model(domainKey, {
			kind: "image",
			source: "provider",
			src: provider.href,
			treatment: provider.treatment,
			width: provider.width,
			height: provider.height,
			fetchedAt,
		});
		return;
	}
	if (provider.kind === "missed") {
		// Nothing anywhere → letter-mark forever (re-probed past the TTL).
		model(domainKey, {
			kind: "none",
			source: "provider",
			src: "",
			treatment: "glyph",
			width: 0,
			height: 0,
			fetchedAt,
		});
	}
	// provider unreachable → no record; next session retries.
}
