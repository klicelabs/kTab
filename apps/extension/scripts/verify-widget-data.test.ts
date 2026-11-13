import { expect, test } from "bun:test";
import {
	fetchGitHubWidgetData,
	type GitHubWidgetRequestOptions,
} from "../src/services/github-widget-data";
import { fetchMarketQuotes } from "../src/services/market-data";

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function yahooResponse(symbol: string) {
	if (symbol === "BAD")
		return { chart: { result: null, error: { code: "Not Found" } } };
	return {
		chart: {
			result: [
				{
					meta: {
						longName:
							symbol === "^BVSP" ? "IBOVESPA" : "The Walt Disney Company",
						currency: "BRL",
						regularMarketPrice: 125_053.4,
						chartPreviousClose: 126_147.4,
					},
					timestamp: [1_762_900_000, 1_762_900_300, 1_762_900_600],
					indicators: { quote: [{ close: [124_900, null, 125_053.4] }] },
				},
			],
			error: null,
		},
	};
}

test("market requests are capped, normalized, and keep working quotes when one ticker fails", async () => {
	const requested: string[] = [];
	const fetcher: typeof fetch = async (input) => {
		const url = new URL(input.toString());
		const symbol = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
		requested.push(symbol);
		if (symbol === "BAD") return jsonResponse(yahooResponse(symbol), 404);
		expect(url.searchParams.get("range")).toBe("1d");
		expect(url.searchParams.get("interval")).toBe("5m");
		return jsonResponse(yahooResponse(symbol));
	};

	const quotes = await fetchMarketQuotes([" ^bvsp ", "dis", "bad", "aapl"], {
		fetcher,
	});
	expect(requested).toEqual(["^BVSP", "DIS", "BAD"]);
	expect(quotes).toHaveLength(2);
	expect(quotes[0]).toMatchObject({
		symbol: "^BVSP",
		name: "IBOVESPA",
		price: 125_053.4,
		previousClose: 126_147.4,
		change: -1_094,
		currency: "BRL",
	});
	expect(quotes[0]?.points).toEqual([
		{ time: 1_762_900_000, close: 124_900 },
		{ time: 1_762_900_600, close: 125_053.4 },
	]);
});

test("public GitHub mode uses profile contributions and recent public activity", async () => {
	const requested: string[] = [];
	const now = new Date("2026-11-12T12:00:00.000Z");
	const fetcher: typeof fetch = async (input, init) => {
		const url = new URL(input.toString());
		requested.push(url.href);
		expect(new Headers(init?.headers).get("authorization")).toBeNull();
		if (url.hostname === "github-contributions-api.jogruber.de") {
			return jsonResponse({
				total: { "2025": 210, "2026": 100 },
				contributions: [
					{ date: "2026-11-12", count: 15 },
					{ date: "2026-11-11", count: 10 },
				],
			});
		}
		return jsonResponse([
			{
				type: "PushEvent",
				created_at: "2026-11-12T11:00:00Z",
				payload: { commits: [{}, {}] },
			},
			{ type: "IssuesEvent", created_at: "2026-11-12T10:00:00Z", payload: {} },
			{
				type: "PullRequestEvent",
				created_at: "2026-11-11T10:00:00Z",
				payload: {},
			},
			{
				type: "PullRequestReviewEvent",
				created_at: "2026-11-10T10:00:00Z",
				payload: {},
			},
			{
				type: "CreateEvent",
				created_at: "2026-11-09T10:00:00Z",
				payload: { ref_type: "repository" },
			},
		]);
	};

	const data = await fetchGitHubWidgetData("octocat", "", { fetcher, now });
	expect(requested).toHaveLength(2);
	expect(data).toMatchObject({
		username: "octocat",
		today: 15,
		best: 15,
		total: 310,
		dataScope: "public",
		radars: {
			commits: 2,
			issues: 1,
			pullRequests: 1,
			reviews: 1,
			repositories: 1,
		},
	});
	expect(data.contributions).toHaveLength(70);
	expect(data.contributions.at(-1)).toEqual({ date: "2026-11-12", count: 15 });
});

test("optional GitHub tokens are sent only to GitHub's GraphQL endpoint", async () => {
	const calls: Array<{ url: string; authorization: string | null }> = [];
	const fetcher: typeof fetch = async (input, init) => {
		const url = new URL(input.toString());
		calls.push({
			url: url.href,
			authorization: new Headers(init?.headers).get("authorization"),
		});
		return jsonResponse({
			data: {
				user: {
					contributionsCollection: {
						totalCommitContributions: 4,
						totalIssueContributions: 2,
						totalPullRequestContributions: 1,
						totalPullRequestReviewContributions: 3,
						totalRepositoryContributions: 1,
						contributionCalendar: {
							totalContributions: 10,
							weeks: [
								{
									contributionDays: [
										{ date: "2026-11-12", contributionCount: 4 },
									],
								},
							],
						},
					},
				},
			},
		});
	};
	const options: GitHubWidgetRequestOptions = {
		fetcher,
		now: new Date("2026-11-12T12:00:00.000Z"),
	};
	const data = await fetchGitHubWidgetData(
		"octocat",
		"ghp_local-token",
		options,
	);
	expect(calls).toHaveLength(1);
	expect(new URL(calls[0]?.url ?? "").origin).toBe("https://api.github.com");
	expect(calls[0]?.authorization).toBe("Bearer ghp_local-token");
	expect(data.dataScope).toBe("authenticated");
	expect(data.total).toBe(10);
	expect(data.radars).toEqual({
		commits: 4,
		issues: 2,
		pullRequests: 1,
		reviews: 3,
		repositories: 1,
	});
});
