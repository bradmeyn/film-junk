import episodesJson from '../data/episodes.json';
import filmsJson from '../data/films.json';
import metaJson from '../data/meta.json';

import type { Episode, Film, Meta, Review } from './types';
export type * from './types';

export const episodes = episodesJson as unknown as Episode[];
export const films = filmsJson as unknown as Film[];
export const meta = metaJson as unknown as Meta;

export const episodeById = new Map(episodes.map((e) => [e.id, e]));
export const filmBySlug = new Map(films.map((f) => [f.slug, f]));

export const LINKS = {
	patreon: 'https://www.patreon.com/filmjunk',
	spotify: 'https://open.spotify.com/show/7gC4H6NxbAnQLB7ahS5u2P',
	bandcamp: 'https://filmjunk.bandcamp.com/',
	gumroad: 'https://filmjunk.gumroad.com/',
	apple: 'https://podcasts.apple.com/podcast/film-junk-podcast/id74257105',
	rss: 'https://feeds.feedburner.com/filmjunk',
	site: 'https://www.filmjunk.com',
};

// From Film Junk's Linktree (linktr.ee/filmjunk) and the hosts' own pages.
export const HOSTS = [
	{
		key: 'Sean',
		slug: 'sean-dwyer',
		name: 'Sean Dwyer',
		links: [
			{ label: 'Letterboxd', icon: 'letterboxd', url: 'https://letterboxd.com/filmjunk/' },
			{ label: 'Space Junk on Substack', icon: 'substack', url: 'https://www.spacejunk.org/' },
		],
	},
	{
		key: 'Jay',
		slug: 'jay-cheel',
		name: 'Jay Cheel',
		links: [
			{ label: 'Letterboxd', icon: 'letterboxd', url: 'https://letterboxd.com/jay_c/' },
			{ label: 'ART BRUT on Patreon', icon: 'patreon', url: 'https://www.patreon.com/artbrutfilms' },
		],
	},
	{
		key: 'Frank',
		slug: 'frank-knezic',
		name: 'Frank Knezic',
		links: [{ label: 'Letterboxd', icon: 'letterboxd', url: 'https://letterboxd.com/dirrrtyfrank/' }],
	},
] as const;

// Ratings use first names ("Sean"); only the three regular hosts have pages.
export function hostHref(key: string) {
	const host = HOSTS.find((h) => h.key === key);
	return host ? `/hosts/${host.slug}/` : null;
}

// Must match slugify in scripts/build-data.mjs.
export function slugify(s: string) {
	return s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function filmHref(slug: string | null | undefined) {
	return slug && filmBySlug.has(slug) ? `/films/${slug}/` : null;
}

// TMDB poster sizes: w92, w154, w185, w342, w500, w780.
export function posterUrl(path: string | null | undefined, size: 'w154' | 'w342' | 'w500' = 'w342') {
	return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

// Artwork for an episode: the premium's Bandcamp cover, else the first reviewed film's poster.
export function episodeArt(e: Episode) {
	if (e.art) return { src: e.art, square: true };
	const poster = e.reviews?.map((r) => r.film && filmBySlug.get(r.film)?.poster).find(Boolean);
	return poster ? { src: posterUrl(poster, 'w500')!, square: false } : null;
}

// Where to read more about a film. Letterboxd resolves TMDB ids itself (films only, not TV).
export function filmLinks(f: Film) {
	const links: { label: string; icon: 'letterboxd' | 'imdb'; url: string }[] = [];
	if (f.tmdb?.type === 'movie') links.push({ label: 'Letterboxd', icon: 'letterboxd', url: `https://letterboxd.com/tmdb/${f.tmdb.id}/` });
	else if (!f.tmdb) links.push({ label: 'Search Letterboxd', icon: 'letterboxd', url: `https://letterboxd.com/search/films/${encodeURIComponent(f.title)}/` });
	if (f.imdb) links.push({ label: 'IMDb', icon: 'imdb', url: `https://www.imdb.com/title/${f.imdb}/` });
	return links;
}

export function episodeHref(e: Episode) {
	return `/episodes/${e.id}/`;
}

export function episodeLabel(e: Episode) {
	if (e.kind === 'premium') return e.number ? `Premium #${e.number}` : 'Premium';
	if (e.kind === 'bonus') return 'Bonus';
	if (e.kind === 'patreon') return 'Patreon exclusive';
	if (!e.number) return e.show ?? 'Episode';
	return `${e.show === 'Space Junk' ? 'Space Junk' : 'Episode'} ${e.number}${e.part ? ` (part ${e.part})` : ''}`;
}

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export function formatDate(iso: string, approx = false) {
	return (approx ? 'c. ' : '') + dateFormat.format(new Date(iso + 'T00:00:00Z'));
}

// Average of all host ratings for an episode's reviews, normalised to 5 stars.
export function averageRating(reviews: Review[] = []) {
	// "6 out of 5" counts as 5 so it doesn't skew averages.
	const scores = reviews.flatMap((r) => r.ratings.map((x) => Math.min(5, (x.score / x.outOf) * 5)));
	if (!scores.length) return null;
	return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 2) / 2;
}

export function formatDuration(seconds: number | null | undefined) {
	if (!seconds) return null;
	const h = Math.floor(seconds / 3600);
	const m = Math.round((seconds % 3600) / 60);
	return h ? `${h} hr ${m} min` : `${m} min`;
}

export const years = [...new Set(episodes.map((e) => e.date.slice(0, 4)))].sort().reverse();
