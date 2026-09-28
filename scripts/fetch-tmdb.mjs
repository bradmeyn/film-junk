// Looks up every reviewed film on TMDB and caches the match in data/tmdb.json.
// Reads src/data/episodes.json, so run build-data first (npm run data does both).
// Needs TMDB_API_KEY (v3 key) or TMDB_READ_TOKEN (v4 read access token), e.g. in .env.
// Usage: node scripts/fetch-tmdb.mjs [--retry]   (--retry re-queries titles that found nothing)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

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

const retry = process.argv.includes('--retry');
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const episodes = JSON.parse(readFileSync('src/data/episodes.json', 'utf8'));

// Must match tmdbKey in build-data.mjs.
const key = (title, year, episodeYear) => `${title.toLowerCase()}|${year ?? ''}|${year ? '' : episodeYear}`;

const wanted = new Map();
for (const e of episodes) {
	const episodeYear = +e.date.slice(0, 4);
	for (const r of e.reviews ?? []) wanted.set(key(r.title, r.year, episodeYear), { title: r.title, year: r.year, episodeYear });
}

async function api(path, params) {
	const url = new URL(`https://api.themoviedb.org/3${path}`);
	for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
	if (TMDB_API_KEY) url.searchParams.set('api_key', TMDB_API_KEY);
	const headers = TMDB_READ_TOKEN ? { authorization: `Bearer ${TMDB_READ_TOKEN}` } : {};
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { headers });
		if (res.status === 429 && attempt < 5) {
			await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
			continue;
		}
		if (!res.ok) throw new Error(`TMDB ${res.status} for ${path}: ${await res.text()}`);
		return res.json();
	}
}

const norm = (s) =>
	s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/&/g, 'and')
		.replace(/[^a-z0-9]+/g, '');

const exact = (results, title, field) =>
	results.find((r) => [r[field], r.original_title, r.original_name].some((t) => t && norm(t) === norm(title)));

// Loose fallback: the top result, only if one title contains the other.
const loose = (results, title, field) => {
	const top = results[0];
	if (!top) return null;
	const a = norm(title);
	const b = norm(top[field] ?? '');
	return b && (a.includes(b) || b.includes(a)) ? top : null;
};

// votes: TMDB vote count, used to find the biggest films of a year.
const movie = (hit) => ({ type: 'movie', id: hit.id, title: hit.title, year: +hit.release_date?.slice(0, 4) || null, poster: hit.poster_path, votes: hit.vote_count });
const tv = (hit) => ({ type: 'tv', id: hit.id, title: hit.name, year: +hit.first_air_date?.slice(0, 4) || null, poster: hit.poster_path, votes: hit.vote_count });

async function lookup({ title, year, episodeYear }) {
	const searchMovies = (y) => api('/search/movie', { query: title, year: y, include_adult: 'false' }).then((d) => d.results);
	// A year in the title ("Rad (1986)") is exact. Otherwise it's usually a new
	// release, so try the episode's year and the year before, then any year.
	const years = year ? [year, null] : [episodeYear, episodeYear - 1, null];
	let open = [];
	for (const y of years) {
		const results = await searchMovies(y);
		if (y === null) open = results;
		const hit = exact(results, title, 'title');
		if (hit) return movie(hit);
	}
	// TV reviews look like "The Mandalorian: Season 2".
	const show = title.replace(/\s*[:\-–]\s*(season|series)\s*\d+.*$/i, '').trim();
	const shows = (await api('/search/tv', { query: show })).results;
	const tvHit = exact(shows, show, 'name');
	if (tvHit) return tv(tvHit);
	const fuzzyMovie = loose(open, title, 'title');
	if (fuzzyMovie) return movie(fuzzyMovie);
	const fuzzyShow = loose(shows, show, 'name');
	return fuzzyShow ? tv(fuzzyShow) : null;
}

// Upcoming films from the monthly schedule, so they have posters before their episode airs.
const schedule = existsSync('data/schedule.json') ? JSON.parse(readFileSync('data/schedule.json', 'utf8')) : {};
for (const [month, m] of Object.entries(schedule)) {
	if (month.startsWith('_')) continue;
	for (const item of m.items) {
		const episodeYear = +item.date.slice(0, 4);
		wanted.set(key(item.title, item.year, episodeYear), { title: item.title, year: item.year, episodeYear });
	}
}

const todo = [...wanted].filter(([k]) => !(k in cache) || (retry && cache[k] === null));
console.log(`tmdb: ${wanted.size} reviewed titles, ${todo.length} to look up`);

let done = 0;
const CONCURRENCY = 6;
async function worker() {
	while (todo.length) {
		const [k, item] = todo.shift();
		try {
			cache[k] = await lookup(item);
		} catch (err) {
			console.error(`tmdb: ${item.title}: ${err.message}`);
			if (/TMDB 401/.test(err.message)) process.exit(1);
		}
		if (++done % 100 === 0) {
			console.log(`tmdb: ${done} done`);
			writeFileSync(CACHE, JSON.stringify(cache, null, '\t'));
		}
	}
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

writeFileSync(CACHE, JSON.stringify(cache, null, '\t'));
const values = Object.values(cache);
console.log(`tmdb: ${values.filter(Boolean).length} matched, ${values.filter((v) => v === null).length} not found`);
