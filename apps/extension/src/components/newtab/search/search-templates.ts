import { searchDestination } from "./search-destinations";

export interface SearchTemplate {
	id: string;
	label: string;
	searchUrl: (query: string) => string;
}

function encodedSearch(parameter: string, baseUrl: string) {
	return (query: string) => {
		const url = new URL(baseUrl);
		url.searchParams.set(parameter, query.trim());
		return url.toString();
	};
}

const BUILTIN_TEMPLATES: SearchTemplate[] = [
	{
		id: "youtube",
		label: "YouTube",
		searchUrl: encodedSearch("search_query", "https://www.youtube.com/results"),
	},
	{
		id: "amazon",
		label: "Amazon",
		searchUrl: encodedSearch("k", "https://www.amazon.com/s"),
	},
	{
		id: "github",
		label: "GitHub",
		searchUrl: encodedSearch("q", "https://github.com/search"),
	},
	{
		id: "reddit",
		label: "Reddit",
		searchUrl: encodedSearch("q", "https://www.reddit.com/search/"),
	},
	{
		id: "wikipedia",
		label: "Wikipedia",
		searchUrl: encodedSearch("search", "https://en.wikipedia.org/w/index.php"),
	},
	{
		id: "x",
		label: "X",
		searchUrl: encodedSearch("q", "https://x.com/search"),
	},
	{
		id: "stackoverflow",
		label: "Stack Overflow",
		searchUrl: encodedSearch("q", "https://stackoverflow.com/search"),
	},
];

const ALIASES: Record<string, string> = {
	amazon: "amazon",
	amazoncom: "amazon",
	amz: "amazon",
	github: "github",
	githubcom: "github",
	gh: "github",
	reddit: "reddit",
	redditcom: "reddit",
	stackoverflow: "stackoverflow",
	stackoverflowcom: "stackoverflow",
	so: "stackoverflow",
	twitter: "x",
	twittercom: "x",
	x: "x",
	xcom: "x",
	youtube: "youtube",
	youtubecom: "youtube",
	yt: "youtube",
	wikipedia: "wikipedia",
	wikipediaorg: "wikipedia",
	wiki: "wikipedia",
};

const TEMPLATE_BY_ID = new Map(
	BUILTIN_TEMPLATES.map((template) => [template.id, template]),
);

function templateForHost(hostname: string): SearchTemplate | null {
	const host = hostname.toLowerCase().replace(/^www\./, "");
	const id = ALIASES[host.replace(/[^\p{L}\p{N}]/gu, "")];
	if (id) return TEMPLATE_BY_ID.get(id) ?? null;
	if (host.endsWith(".wikipedia.org"))
		return TEMPLATE_BY_ID.get("wikipedia") ?? null;
	if (host.endsWith(".youtube.com"))
		return TEMPLATE_BY_ID.get("youtube") ?? null;
	return null;
}

function siteSearchTemplate(hostname: string): SearchTemplate {
	const host = hostname.toLowerCase().replace(/^www\./, "");
	return {
		id: `site:${host}`,
		label: host,
		searchUrl: (query) => {
			const url = new URL("https://www.google.com/search");
			url.searchParams.set("q", `site:${host} ${query.trim()}`);
			return url.toString();
		},
	};
}

/** Resolve a provider keyword or a typed web domain into a search target. */
export function resolveSearchTemplate(input: string): SearchTemplate | null {
	const value = input.trim();
	if (!value) return null;

	const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
	const alias = ALIASES[normalized];
	if (alias) return TEMPLATE_BY_ID.get(alias) ?? null;

	const destination = searchDestination(value);
	if (!destination) return null;
	const hostname = new URL(destination).hostname.toLowerCase();
	const known = templateForHost(hostname);
	if (known) return known;
	if (!hostname.includes(".")) return null;
	return siteSearchTemplate(hostname);
}

/** Build the search destination after a user enters a site query. */
export function buildTemplateSearchUrl(
	template: SearchTemplate,
	query: string,
): string {
	return query.trim() ? template.searchUrl(query) : "";
}
