import { expect, test } from "bun:test";
import {
	buildTemplateSearchUrl,
	resolveSearchTemplate,
} from "../src/components/newtab/search/search-templates";

test("built-in provider names and aliases resolve to their search engine", () => {
	for (const [input, id] of [
		["youtube.com", "youtube"],
		["yt", "youtube"],
		["amazon.com", "amazon"],
		["github.com", "github"],
		["reddit", "reddit"],
		["wikipedia.org", "wikipedia"],
		["twitter.com", "x"],
		["stackoverflow.com", "stackoverflow"],
		["stack overflow", "stackoverflow"],
	] as const) {
		expect(resolveSearchTemplate(input)?.id).toBe(id);
	}
});

test("provider searches encode arbitrary query text in the site's expected parameter", () => {
	const youtube = resolveSearchTemplate("yt");
	const amazon = resolveSearchTemplate("amazon");
	const wikipedia = resolveSearchTemplate("wiki");
	expect(
		youtube &&
			new URL(buildTemplateSearchUrl(youtube, "cats & dogs")).searchParams.get(
				"search_query",
			),
	).toBe("cats & dogs");
	expect(
		amazon &&
			new URL(buildTemplateSearchUrl(amazon, "USB-C hub")).searchParams.get(
				"k",
			),
	).toBe("USB-C hub");
	expect(
		wikipedia &&
			new URL(buildTemplateSearchUrl(wikipedia, "São Paulo")).searchParams.get(
				"search",
			),
	).toBe("São Paulo");
});

test("an unknown domain uses Google site search with only its hostname", () => {
	const template = resolveSearchTemplate(
		"https://docs.example.org/guide?tab=api",
	);
	expect(template?.id).toBe("site:docs.example.org");
	if (!template) throw new Error("Expected custom site search template");
	const target = new URL(buildTemplateSearchUrl(template, "open source icons"));
	expect(target.origin + target.pathname).toBe("https://www.google.com/search");
	expect(target.searchParams.get("q")).toBe(
		"site:docs.example.org open source icons",
	);
});

test("ordinary phrases and unsafe schemes do not become provider badges", () => {
	for (const input of [
		"",
		"what is youtube",
		"javascript:alert(1)",
		"google.com query",
	])
		expect(resolveSearchTemplate(input)).toBeNull();
});
