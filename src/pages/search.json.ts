import type { APIRoute } from 'astro';
import { films } from '../lib/data';

// Compact film index for client-side search: [slug, title, year, reviews, mentions].
export const GET: APIRoute = () => {
	const rows = films
		.map((f) => {
			const reviews = f.appearances.filter((a) => a.role !== 'watched').length;
			return [f.slug, f.title, f.year ?? 0, reviews, f.appearances.length - reviews] as const;
		})
		.sort((a, b) => b[3] * 3 + b[4] - (a[3] * 3 + a[4]));
	return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
};
