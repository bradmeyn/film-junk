// Looks up every reviewed film on TMDB and caches the match in data/tmdb.json.
// Reads src/data/episodes.json, so run build-data first (npm run data does both).
// Needs TMDB_API_KEY (v3 key) or TMDB_READ_TOKEN (v4 read access token), e.g. in .env.
// Usage: node scripts/fetch-tmdb.ts [--retry]   (--retry re-queries titles that found nothing)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { Episode, TmdbCache, TmdbMatch } from '../src/lib/types.ts';

const CACHE = 'data/tmdb.json';
// Either credential from TMDB's API settings works; the long read token is sent as a bearer token.
const credential = process.env.TMDB_READ_TOKEN || process.env.TMDB_API_KEY;
const isToken = credential?.startsWith('eyJ');
const TMDB_API_KEY = isToken ? null : credential;
const TMDB_READ_TOKEN = isToken ? credential : null;
if (!TMDB_API_KEY && !TMDB_READ_TOKEN) {
	console.log('tmdb: skipped (no TMDB_API_KEY / TMDB_READ_TOKEN)');
	process.exit(0);
}

type Wanted = { title: string; year: number | null; episodeYear: number };
// The fields we use from TMDB search results.
type MovieResult = { id: number; title: string; original_title?: string; release_date?: string; poster_path: string | null; vote_count: number };
type TvResult = { id: number; name: string; original_name?: string; first_air_date?: string; poster_path: string | null; vote_count: number };
type SearchResponse<T> = { results: T[] };

const retry = process.argv.includes('--retry');
const cache: TmdbCache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const episodes: Episode[] = JSON.parse(readFileSync('src/data/episodes.json', 'utf8'));

// Must match tmdbKey in build-data.ts.
const key = (title: string, year: number | null, episodeYear: number) =>
	`${title.toLowerCase()}|${year ?? ''}|${year ? '' : episodeYear}`;

const wanted = new Map<string, Wanted>();
for (const e of episodes) {
	const episodeYear = +e.date.slice(0, 4);
	for (const r of e.reviews ?? []) wanted.set(key(r.title, r.year, episodeYear), { title: r.title, year: r.year, episodeYear });
}

// Upcoming films from the monthly schedule, so they have posters before their episode airs.
type ScheduleFile = Record<string, { items: { date: string; title: string; year: number | null }[] }>;
const schedule: ScheduleFile = existsSync('data/schedule.json') ? JSON.parse(readFileSync('data/schedule.json', 'utf8')) : {};
for (const [month, m] of Object.entries(schedule)) {
	if (month.startsWith('_')) continue;
	for (const item of m.items) {
		const episodeYear = +item.date.slice(0, 4);
		wanted.set(key(item.title, item.year, episodeYear), { title: item.title, year: item.year, episodeYear });
	}
}

async function api<T>(path: string, params: Record<string, string | number | null>): Promise<T> {
	const url = new URL(`https://api.themoviedb.org/3${path}`);
	for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
	if (TMDB_API_KEY) url.searchParams.set('api_key', TMDB_API_KEY);
	const headers: Record<string, string> = TMDB_READ_TOKEN ? { authorization: `Bearer ${TMDB_READ_TOKEN}` } : {};
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { headers });
		if (res.status === 429 && attempt < 5) {
			await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
			continue;
		}
		if (!res.ok) throw new Error(`TMDB ${res.status} for ${path}: ${await res.text()}`);
		return (await res.json()) as T;
	}
}

const norm = (s: string) =>
	s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/&/g, 'and')
		.replace(/[^a-z0-9]+/g, '');

const titlesOf = (r: MovieResult | TvResult) =>
	'title' in r ? [r.title, r.original_title] : [r.name, r.original_name];

const exact = <T extends MovieResult | TvResult>(results: T[], title: string) =>
	results.find((r) => titlesOf(r).some((t) => t && norm(t) === norm(title)));

// Of all exact title matches, the most-rated: the likeliest one a host means in passing.
const mostRated = <T extends MovieResult | TvResult>(results: T[], title: string) =>
	results
		.filter((r) => titlesOf(r).some((t) => t && norm(t) === norm(title)))
		.sort((a, b) => b.vote_count - a.vote_count)[0];

// Loose fallback: the top result, only if one title contains the other.
const loose = <T extends MovieResult | TvResult>(results: T[], title: string) => {
	const top = results[0];
	if (!top) return null;
	const a = norm(title);
	const b = norm(titlesOf(top)[0] ?? '');
	return b && (a.includes(b) || b.includes(a)) ? top : null;
};

// votes: TMDB vote count, used to find the biggest films of a year.
const movie = (hit: MovieResult): TmdbMatch => ({
	type: 'movie',
	id: hit.id,
	title: hit.title,
	year: +(hit.release_date?.slice(0, 4) ?? '') || null,
	poster: hit.poster_path,
	votes: hit.vote_count,
});
const tv = (hit: TvResult): TmdbMatch => ({
	type: 'tv',
	id: hit.id,
	title: hit.name,
	year: +(hit.first_air_date?.slice(0, 4) ?? '') || null,
	poster: hit.poster_path,
	votes: hit.vote_count,
});

async function lookup({ title, year, episodeYear }: Wanted): Promise<TmdbMatch | null> {
	const searchMovies = (y: number | null) =>
		api<SearchResponse<MovieResult>>('/search/movie', { query: title, year: y, include_adult: 'false' }).then((d) => d.results);
	// A year in the title ("Rad (1986)") is exact. Otherwise it's usually a new
	// release, so try the episode's year and the year before, then any year.
	const years = year ? [year, null] : [episodeYear, episodeYear - 1, null];
	let open: MovieResult[] = [];
	for (const y of years) {
		const results = await searchMovies(y);
		if (y === null) open = results;
		const hit = exact(results, title);
		if (hit) return movie(hit);
	}
	// TV reviews look like "The Mandalorian: Season 2".
	const show = title.replace(/\s*[:\-–]\s*(season|series)\s*\d+.*$/i, '').trim();
	const shows = (await api<SearchResponse<TvResult>>('/search/tv', { query: show })).results;
	const tvHit = exact(shows, show);
	if (tvHit) return tv(tvHit);
	const fuzzyMovie = loose(open, title);
	if (fuzzyMovie) return movie(fuzzyMovie);
	const fuzzyShow = loose(shows, show);
	return fuzzyShow ? tv(fuzzyShow) : null;
}

// Films only mentioned in passing ("what we watched", descriptions, premium covers).
// There's no context to go on, so only exact title matches count; see lookupMention.
const mentionKey = (title: string, year: number | null) => `m|${title.toLowerCase()}|${year ?? ''}`;
const mentions = new Map<string, { title: string; year: number | null }>();
for (const e of episodes)
	for (const { title, year } of [
		...(e.watched ?? []),
		...(e.mentioned ?? []),
		...(e.covers ?? []).map((c) => ({ title: c.title, year: null })),
	]) {
		if (title.length >= 2) mentions.set(mentionKey(title, year), { title, year });
	}

async function lookupMention({ title, year }: { title: string; year: number | null }): Promise<TmdbMatch | null> {
	const films = await api<SearchResponse<MovieResult>>('/search/movie', { query: title, year, include_adult: 'false' });
	const film = mostRated(films.results, title);
	if (film) return movie(film);
	const show = title.replace(/\s*[:\-–]\s*(season|series)\s*\d+.*$/i, '').replace(/\s+season\s+\d+$/i, '').trim();
	const shows = await api<SearchResponse<TvResult>>('/search/tv', { query: show });
	const series = mostRated(shows.results, show);
	return series ? tv(series) : null;
}

// IMDb ids come from a separate endpoint; fetched once per matched film and cached with it.
async function addImdb(match: TmdbMatch) {
	const ids = await api<{ imdb_id?: string | null }>(`/${match.type}/${match.id}/external_ids`, {});
	match.imdb = ids.imdb_id || null;
}

type Job = { key: string; run: () => Promise<void>; label: string };
const jobs: Job[] = [];
for (const [k, item] of wanted)
	if (!(k in cache) || (retry && cache[k] === null))
		jobs.push({ key: k, label: item.title, run: async () => void (cache[k] = await lookup(item)) });
for (const [k, item] of mentions)
	if (!(k in cache) || (retry && cache[k] === null))
		jobs.push({ key: k, label: item.title, run: async () => void (cache[k] = await lookupMention(item)) });
console.log(`tmdb: ${wanted.size} reviewed and ${mentions.size} mentioned titles, ${jobs.length} to look up`);

let done = 0;
const CONCURRENCY = 6;
async function worker(queue: Job[]) {
	for (let job = queue.shift(); job; job = queue.shift()) {
		try {
			await job.run();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`tmdb: ${job.label}: ${message}`);
			if (/TMDB 401/.test(message)) process.exit(1);
		}
		if (++done % 100 === 0) {
			console.log(`tmdb: ${done} done`);
			writeFileSync(CACHE, JSON.stringify(cache, null, '\t'));
		}
	}
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(jobs)));

// Then IMDb ids for every match that doesn't have one yet.
const imdbJobs: Job[] = Object.entries(cache)
	.filter((entry): entry is [string, TmdbMatch] => entry[1] !== null && entry[1].imdb === undefined)
	.map(([k, match]) => ({ key: k, label: match.title, run: () => addImdb(match) }));
console.log(`tmdb: ${imdbJobs.length} IMDb ids to fetch`);
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(imdbJobs)));

writeFileSync(CACHE, JSON.stringify(cache, null, '\t'));
const values = Object.values(cache);
console.log(`tmdb: ${values.filter(Boolean).length} matched, ${values.filter((v) => v === null).length} not found`);
