export interface GitHubContributionDay {
	date: string;
	count: number;
}

export interface GitHubWidgetData {
	username: string;
	today: number;
	best: number;
	total: number;
	contributions: GitHubContributionDay[];
	radars: {
		commits: number;
		issues: number;
		pullRequests: number;
		reviews: number;
		repositories: number;
	};
	dataScope: "public" | "authenticated";
}

export interface GitHubWidgetRequestOptions {
	fetcher?: typeof fetch;
	signal?: AbortSignal;
	now?: Date;
}

const CONTRIBUTIONS_API = "https://github-contributions-api.jogruber.de/v4/";
const GITHUB_API = "https://api.github.com";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asCount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? Math.floor(value)
		: 0;
}

async function requestJson(
	url: string,
	options: GitHubWidgetRequestOptions,
	headers?: HeadersInit,
	body?: string,
): Promise<unknown> {
	const requestHeaders = new Headers({ accept: "application/vnd.github+json" });
	if (headers) {
		new Headers(headers).forEach((value, key) => {
			requestHeaders.set(key, value);
		});
	}
	const response = await (options.fetcher ?? fetch)(url, {
		method: body ? "POST" : "GET",
		cache: "no-store",
		credentials: "omit",
		referrerPolicy: "no-referrer",
		signal: options.signal,
		headers: requestHeaders,
		body,
	});
	if (!response.ok) {
		throw new Error(`GitHub data request failed (${response.status}).`);
	}
	return response.json();
}

function localDate(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function contributionDays(values: unknown, now: Date): GitHubContributionDay[] {
	const byDate = new Map<string, number>();
	if (Array.isArray(values)) {
		for (const value of values) {
			if (!isRecord(value) || typeof value.date !== "string") continue;
			byDate.set(value.date, asCount(value.count));
		}
	}
	const today = new Date(
		Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
	);
	const result: GitHubContributionDay[] = [];
	for (let offset = 69; offset >= 0; offset--) {
		const date = new Date(today);
		date.setUTCDate(today.getUTCDate() - offset);
		const key = date.toISOString().slice(0, 10);
		result.push({ date: key, count: byDate.get(key) ?? 0 });
	}
	return result;
}

function normalizePublicContributions(
	value: unknown,
	username: string,
	now: Date,
) {
	if (!isRecord(value) || !Array.isArray(value.contributions)) {
		throw new Error("GitHub contribution data was incomplete.");
	}
	const rows = value.contributions.filter(isRecord);
	const total = isRecord(value.total)
		? Object.values(value.total).reduce<number>(
				(sum, count) => sum + asCount(count),
				0,
			)
		: rows.reduce((sum, row) => sum + asCount(row.count), 0);
	const days = contributionDays(rows, now);
	return {
		username,
		today: days.at(-1)?.count ?? 0,
		best: Math.max(0, ...rows.map((row) => asCount(row.count))),
		total,
		contributions: days,
	};
}

function publicEventMetrics(value: unknown) {
	if (!Array.isArray(value))
		throw new Error("GitHub activity data was incomplete.");
	const counts = {
		commits: 0,
		issues: 0,
		pullRequests: 0,
		reviews: 0,
		repositories: 0,
	};
	const days = new Map<string, number>();
	for (const event of value) {
		if (!isRecord(event) || typeof event.type !== "string") continue;
		const date =
			typeof event.created_at === "string" ? event.created_at.slice(0, 10) : "";
		const payload = isRecord(event.payload) ? event.payload : {};
		let contribution = 0;
		switch (event.type) {
			case "PushEvent": {
				const commits = Array.isArray(payload.commits)
					? payload.commits.length
					: 0;
				contribution = Math.max(commits, asCount(payload.size));
				counts.commits += contribution;
				break;
			}
			case "IssuesEvent":
				contribution = 1;
				counts.issues += 1;
				break;
			case "PullRequestEvent":
				contribution = 1;
				counts.pullRequests += 1;
				break;
			case "PullRequestReviewEvent":
				contribution = 1;
				counts.reviews += 1;
				break;
			case "CreateEvent":
				if (payload.ref_type === "repository") {
					contribution = 1;
					counts.repositories += 1;
				}
				break;
		}
		if (date && contribution > 0)
			days.set(date, (days.get(date) ?? 0) + contribution);
	}
	return { counts, days };
}

const AUTHENTICATED_QUERY = `
	query WidgetContributions($login: String!, $from: DateTime!, $to: DateTime!) {
		user(login: $login) {
			contributionsCollection(from: $from, to: $to) {
				totalCommitContributions
				totalIssueContributions
				totalPullRequestContributions
				totalPullRequestReviewContributions
				totalRepositoryContributions
				contributionCalendar {
					totalContributions
					weeks { contributionDays { date contributionCount } }
				}
			}
		}
	}`;

async function fetchAuthenticatedData(
	username: string,
	token: string,
	options: GitHubWidgetRequestOptions,
): Promise<GitHubWidgetData> {
	const now = options.now ?? new Date();
	const to = now.toISOString();
	const from = new Date(
		now.getTime() - 365 * 24 * 60 * 60 * 1000,
	).toISOString();
	const payload = await requestJson(
		`${GITHUB_API}/graphql`,
		options,
		{
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		JSON.stringify({
			query: AUTHENTICATED_QUERY,
			variables: { login: username, from, to },
		}),
	);
	if (
		!isRecord(payload) ||
		(Array.isArray(payload.errors) && payload.errors.length > 0)
	) {
		throw new Error(
			"GitHub could not read this profile. Check the username and token.",
		);
	}
	const data = isRecord(payload.data) ? payload.data : null;
	const user = data && isRecord(data.user) ? data.user : null;
	const collection =
		user && isRecord(user.contributionsCollection)
			? user.contributionsCollection
			: null;
	const calendar =
		collection && isRecord(collection.contributionCalendar)
			? collection.contributionCalendar
			: null;
	const weeks = calendar && Array.isArray(calendar.weeks) ? calendar.weeks : [];
	const rawDays = weeks.flatMap((week) =>
		isRecord(week) && Array.isArray(week.contributionDays)
			? week.contributionDays
					.filter(isRecord)
					.map((day) => ({ date: day.date, count: day.contributionCount }))
			: [],
	);
	const days = contributionDays(rawDays, now);
	if (!collection || !calendar) {
		throw new Error(
			"GitHub could not read this profile. Check the username and token.",
		);
	}
	const best = Math.max(
		0,
		...rawDays.map((day) => (isRecord(day) ? asCount(day.count) : 0)),
	);
	return {
		username,
		today: days.at(-1)?.count ?? 0,
		best,
		total: asCount(calendar?.totalContributions),
		contributions: days,
		radars: {
			commits: asCount(collection.totalCommitContributions),
			issues: asCount(collection.totalIssueContributions),
			pullRequests: asCount(collection.totalPullRequestContributions),
			reviews: asCount(collection.totalPullRequestReviewContributions),
			repositories: asCount(collection.totalRepositoryContributions),
		},
		dataScope: "authenticated",
	};
}

/** Read the contribution calendar and public activity for a GitHub profile. */
export async function fetchGitHubWidgetData(
	usernameInput: string,
	tokenInput = "",
	options: GitHubWidgetRequestOptions = {},
): Promise<GitHubWidgetData> {
	const username = usernameInput
		.trim()
		.replace(/[^a-zA-Z0-9-]/g, "")
		.slice(0, 39);
	if (!username) throw new Error("Enter a GitHub username in widget settings.");
	const token = tokenInput.trim();
	const now = options.now ?? new Date();

	if (token) {
		return fetchAuthenticatedData(username, token, options);
	}

	const [contributionsResult, eventsResult] = await Promise.allSettled([
		requestJson(
			`${CONTRIBUTIONS_API}${encodeURIComponent(username)}?y=all`,
			options,
			{ accept: "application/json" },
		),
		requestJson(
			`${GITHUB_API}/users/${encodeURIComponent(username)}/events/public?per_page=100`,
			options,
		),
	]);
	if (eventsResult.status === "rejected") throw eventsResult.reason;
	const activity = publicEventMetrics(eventsResult.value);
	const contributionData =
		contributionsResult.status === "fulfilled"
			? normalizePublicContributions(contributionsResult.value, username, now)
			: (() => {
					const contributions = Array.from(activity.days, ([date, count]) => ({
						date,
						count,
					}));
					const days = contributionDays(contributions, now);
					return {
						username,
						today: days.at(-1)?.count ?? 0,
						best: Math.max(0, ...contributions.map((day) => day.count)),
						total: contributions.reduce((sum, day) => sum + day.count, 0),
						contributions: days,
					};
				})();
	const today = localDate(now);
	const todayCount = contributionData.today || activity.days.get(today) || 0;
	return {
		...contributionData,
		today: todayCount,
		radars: activity.counts,
		dataScope: "public",
	};
}
