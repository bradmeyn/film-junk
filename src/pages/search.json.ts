import type { APIRoute } from 'astro';
import { byDiscussion, directors, episodes, films, reviewCount, type SearchRow } from '../lib/data';

// Compact film index for client-side search: [slug, title, year, reviews, mentions, poster, directors, sixes].
// poster is the TMDB file id without "/" and ".jpg" to keep the file small. Directors with a page
// get a row too, "@steven-soderbergh", ranked by how many of their films the show reviewed.
const posterId = (path: string | null | undefined) => path?.replace(/^\//, '').replace(/\.jpg$/, '') ?? '';

// Films a host rated above the top of the scale: slug → "Sean 6/5, Jay 6/5".
function overTheTop() {
	const sixes = new Map<string, string[]>();
	for (const e of episodes)
		for (const r of e.reviews ?? [])
			for (const x of r.ratings)
				if (r.film && x.score > x.outOf) sixes.set(r.film, [...(sixes.get(r.film) ?? []), `${x.host} ${x.score}/${x.outOf}`]);
	return new Map([...sixes].map(([slug, list]) => [slug, list.join(', ')]));
}

export const GET: APIRoute = () => {
	const sixes = overTheTop();
	const directorRows = [...directors.values()].map((d): SearchRow => {
		const reviewed = d.films.filter((f) => reviewCount(f) > 0).length;
		return [`@${d.slug}`, d.name, 0, reviewed, d.films.length - reviewed, posterId(d.films.toSorted(byDiscussion)[0]?.poster)];
	});
	const rows = films
		.map((f): SearchRow => {
			const reviews = reviewCount(f);
			const poster = posterId(f.poster);
			const row: SearchRow = [f.slug, f.title, f.year ?? 0, reviews, f.appearances.length - reviews, poster];
			// Directors are searchable too ("carpenter"); TV creators aren't.
			if (f.tmdb?.type === 'movie' && f.directors?.length) row[6] = f.directors.map((d) => d.name).join(', ');
			const six = sixes.get(f.slug);
			if (six) (row[6] ??= ''), (row[7] = six);
			return row;
		})
		.concat(directorRows)
		.sort((a, b) => b[3] * 3 + b[4] - (a[3] * 3 + a[4]));
	return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
};
