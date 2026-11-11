import type { SearchEngineDef } from "../../../lib/constants";
import {
	destinationKey,
	type SiteDestination,
	searchDestination,
} from "./search-destinations";

export interface SearchSuggestions {
	queries: string[];
	navigation: SiteDestination[];
}

export const EMPTY_SUGGESTIONS: SearchSuggestions = {
	queries: [],
	navigation: [],
};

/**
 * Optional web suggestion adapter. Suggestions are deliberately best-effort:
 * the local kTab index and the normal web-search action never depend on a
 * third-party endpoint being reachable.
 */
export interface SearchSuggestionProvider {
	suggest: (query: string, signal: AbortSignal) => Promise<SearchSuggestions>;
}

/** Google labels real URL suggestions separately from textual completions.
 * Format reference: Chromium's components/omnibox/browser/search_suggestion_parser.cc.
 * Never turn a QUERY string that happens to contain a domain into a URL. */
export function parseGoogleSuggestions(payload: unknown): SearchSuggestions {
	if (!Array.isArray(payload) || !Array.isArray(payload[1]))
		return EMPTY_SUGGESTIONS;
	const metadata = payload[4];
	const types =
		metadata && typeof metadata === "object"
			? metadata["google:suggesttype"]
			: null;
	const descriptions = Array.isArray(payload[2]) ? payload[2] : [];
	const queries: string[] = [];
	const navigation: SiteDestination[] = [];
	const seen = new Set<string>();
	for (const [index, raw] of payload[1].slice(0, 20).entries()) {
		if (typeof raw !== "string") continue;
		const value = raw.trim();
		if (!value || value.length > 2048) continue;
		if (Array.isArray(types) && types[index] === "NAVIGATION") {
			const url = searchDestination(value);
			if (!url || navigation.length >= 3) continue;
			const key = destinationKey(url);
			if (seen.has(key)) continue;
			seen.add(key);
			const description = descriptions[index];
			navigation.push({
				url,
				title:
					typeof description === "string" && description.trim()
						? description.trim().slice(0, 160)
						: new URL(url).hostname.replace(/^www\./, ""),
			});
		} else if (queries.length < 4 && !seen.has(value.toLowerCase())) {
			seen.add(value.toLowerCase());
			queries.push(value);
		}
	}
	return { queries, navigation };
}

function jsonProvider(
	url: (query: string) => string,
	parse: (payload: unknown) => SearchSuggestions,
): SearchSuggestionProvider {
	return {
		async suggest(query, signal) {
			const response = await fetch(url(query), {
				signal,
				credentials: "omit",
				headers: { Accept: "application/json" },
			});
			if (!response.ok) return EMPTY_SUGGESTIONS;
			const payload: unknown = await response.json();
			return parse(payload);
		},
	};
}

const PROVIDERS: Record<string, SearchSuggestionProvider | undefined> = {
	// The Chrome response includes NAVIGATION metadata. Best-effort and no API
	// key; host access already exists in the extension manifest.
	google: jsonProvider(
		(query) =>
			`https://suggestqueries.google.com/complete/search?client=chrome&ie=UTF-8&oe=UTF-8&q=${encodeURIComponent(query)}`,
		parseGoogleSuggestions,
	),
	duckduckgo: jsonProvider(
		(query) =>
			`https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&kl=wt-wt`,
		(payload) => ({
			queries: Array.isArray(payload)
				? [
						...new Set(
							payload.flatMap((entry) =>
								entry &&
								typeof entry === "object" &&
								"phrase" in entry &&
								typeof entry.phrase === "string" &&
								entry.phrase.trim()
									? [entry.phrase.trim()]
									: [],
							),
						),
					].slice(0, 4)
				: [],
			navigation: [],
		}),
	),
};

export async function getSearchSuggestions(
	engine: SearchEngineDef,
	query: string,
	signal: AbortSignal,
	options?: { allowEmpty?: boolean },
): Promise<SearchSuggestions> {
	const provider = PROVIDERS[engine.id];
	const normalized = query.trim();
	if (
		!provider ||
		signal.aborted ||
		(!options?.allowEmpty && normalized.length < 2)
	)
		return EMPTY_SUGGESTIONS;
	try {
		const values = await provider.suggest(normalized, signal);
		return signal.aborted ? EMPTY_SUGGESTIONS : values;
	} catch {
		// Network/CSP/engine failures are intentionally silent. Search remains
		// useful through the local index and the explicit web-search row.
		return EMPTY_SUGGESTIONS;
	}
}
