export const PEXELS_DEFAULT_QUERY = "cinematic nature landscape 4k";
export const PEXELS_MAX_QUERY_LENGTH = 80;
// Production still points at the Worker deployed under its original name; the
// local config in apps/pexels-worker is already `ktab-pexels`, so this URL only
// changes once that Worker is redeployed under the new name.
export const PEXELS_PROXY_BASE =
	import.meta.env.VITE_PEXELS_PROXY_URL ||
	(import.meta.env.DEV
		? "http://localhost:3001/api/pexels"
		: "https://klice-start-pexels.joaoliveiraam.workers.dev/api/pexels");
export function pexelsProxyUrl(): string {
	return PEXELS_PROXY_BASE;
}
export interface PexelsPhoto {
	id: number;
	url: string;
	photographer: string;
	photographerUrl: string;
	width: number;
	height: number;
	src: {
		original: string;
		large2x: string;
		large: string;
		medium: string;
		small: string;
	};
}
export function normalizePexelsQuery(query: string): string {
	return (
		query
			.normalize("NFKC")
			.trim()
			.replace(/\s+/g, " ")
			.toLowerCase()
			.slice(0, PEXELS_MAX_QUERY_LENGTH) || PEXELS_DEFAULT_QUERY
	);
}
function trustedUrl(value: unknown, image = false): value is string {
	if (typeof value !== "string") return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			(image
				? url.hostname === "images.pexels.com"
				: url.hostname === "pexels.com" || url.hostname.endsWith(".pexels.com"))
		);
	} catch {
		return false;
	}
}
export function isPexelsPhoto(value: unknown): value is PexelsPhoto {
	if (!value || typeof value !== "object") return false;
	const p = value as Record<string, unknown>;
	if (
		!Number.isSafeInteger(p.id) ||
		typeof p.width !== "number" ||
		typeof p.height !== "number" ||
		!Number.isFinite(p.width) ||
		!Number.isFinite(p.height) ||
		p.width < 1920 ||
		p.height < 1080 ||
		p.width <= p.height ||
		typeof p.photographer !== "string" ||
		!trustedUrl(p.url) ||
		!trustedUrl(p.photographerUrl) ||
		!p.src ||
		typeof p.src !== "object"
	)
		return false;
	const src = p.src as Record<string, unknown>;
	return ["original", "large2x", "large", "medium", "small"].every((key) =>
		trustedUrl(src[key], true),
	);
}
/** Keep source pixels intact, cap at 4K, and avoid transferring 4K to smaller screens. */
export function wallpaperImageUrl(
	photo: PexelsPhoto,
	width: number,
	height: number,
	dpr: number,
): string {
	const density = Math.min(3, Math.max(1, dpr || 1));
	const desired = Math.max(
		width * density,
		height * density * (photo.width / photo.height),
	);
	const target = Math.min(
		photo.width,
		3840,
		Math.max(1280, Math.ceil(desired / 320) * 320),
	);
	const url = new URL(photo.src.original);
	url.searchParams.set("auto", "compress");
	url.searchParams.set("cs", "tinysrgb");
	url.searchParams.set("fit", "max");
	url.searchParams.set("w", String(target));
	url.searchParams.set("q", "92");
	url.searchParams.delete("h");
	return url.toString();
}
export function choosePexelsPhoto(
	photos: readonly PexelsPhoto[],
	recent: readonly number[],
	random = Math.random,
): PexelsPhoto | null {
	const candidates = photos.filter((photo) => !recent.includes(photo.id));
	return candidates.length
		? (candidates[
				Math.min(
					candidates.length - 1,
					Math.floor(Math.max(0, random()) * candidates.length),
				)
			] ?? null)
		: null;
}
