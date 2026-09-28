// schema.org JSON-LD for search engines: the podcast, its episodes, the films and the hosts.
// URLs are absolute when the site address is known (SITE_URL) and left out otherwise.
import { HOSTS, LINKS, episodeLabel, filmBySlug, filmLinks, posterUrl, type Episode, type Film, type Review } from './data';

type Site = URL | undefined;
const abs = (site: Site, path: string) => (site ? new URL(path, site).href : undefined);

const PODCAST_IMAGE = 'https://assets.libsyn.com/images/filmjunk/FJ_PodcastArt_3000.jpg';

export function podcastSeries(site: Site) {
	return {
		'@type': 'PodcastSeries',
		name: 'Film Junk Podcast',
		description: 'The longest running film podcast: weekly movie reviews, TV talk and film news from Sean Dwyer, Jay Cheel and Frank Knezic.',
		url: abs(site, '/'),
		image: PODCAST_IMAGE,
		webFeed: LINKS.rss,
		genre: ['Film', 'Movie reviews', 'TV'],
		author: HOSTS.map((h) => ({ '@type': 'Person', name: h.name })),
		sameAs: [LINKS.site, LINKS.spotify, LINKS.apple, LINKS.patreon],
	};
}

export function homeSchema(site: Site) {
	return [
		{
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			name: 'Film Junk Podcast',
			url: abs(site, '/'),
			// Lets search engines offer a search box that lands on the film search.
			potentialAction: site && {
				'@type': 'SearchAction',
				target: { '@type': 'EntryPoint', urlTemplate: `${abs(site, '/films/')}?q={search_term_string}` },
				'query-input': 'required name=search_term_string',
			},
		},
		{ '@context': 'https://schema.org', ...podcastSeries(site) },
	];
}

// A host's rating as a Review. "6 out of 5" is capped so the value stays within the scale.
function reviewOf(review: Review, e: Episode, site: Site) {
	return review.ratings.map((r) => ({
		'@type': 'Review',
		author: { '@type': 'Person', name: HOSTS.find((h) => h.key === r.host)?.name ?? r.host },
		datePublished: e.date,
		url: abs(site, `/episodes/${e.id}/`),
		reviewRating: { '@type': 'Rating', ratingValue: Math.min(r.score, r.outOf), bestRating: r.outOf, worstRating: 0 },
	}));
}

function work(film: Film | undefined, title: string, year: number | null, site: Site) {
	const type = film?.tmdb?.type === 'tv' ? 'TVSeries' : 'Movie';
	return {
		'@type': type,
		name: film?.title ?? title,
		...((film?.year ?? year) && { dateCreated: String(film?.year ?? year) }),
		...(film?.poster && { image: posterUrl(film.poster, 'w500') }),
		...(film && { url: abs(site, `/films/${film.slug}/`), sameAs: filmLinks(film).map((l) => l.url) }),
	};
}

// ISO 8601 duration, e.g. PT1H42M.
const isoDuration = (seconds: number) => `PT${Math.floor(seconds / 3600)}H${Math.round((seconds % 3600) / 60)}M`;

export function episodeSchema(e: Episode, site: Site, image?: string) {
	const films = (e.reviews ?? []).map((r) => work(r.film ? filmBySlug.get(r.film) : undefined, r.title, r.year, site));
	return {
		'@context': 'https://schema.org',
		'@type': 'PodcastEpisode',
		name: `${episodeLabel(e)}: ${e.title}`,
		datePublished: e.date,
		url: abs(site, `/episodes/${e.id}/`),
		...(e.number && e.kind === 'regular' && { episodeNumber: e.number }),
		...(e.description && { description: e.description.slice(0, 500) }),
		...(e.duration && { timeRequired: isoDuration(e.duration) }),
		...(image && { image }),
		...(films.length && { about: films }),
		partOfSeries: { '@type': 'PodcastSeries', name: 'Film Junk Podcast', url: abs(site, '/') },
	};
}

export function filmSchema(film: Film, reviewed: { episode: Episode; review?: Review }[], site: Site) {
	const reviews = reviewed.flatMap(({ episode, review }) => (review ? reviewOf(review, episode, site) : []));
	return {
		'@context': 'https://schema.org',
		...work(film, film.title, film.year, site),
		...(reviews.length && { review: reviews }),
	};
}

export function hostSchema(host: (typeof HOSTS)[number], site: Site) {
	return {
		'@context': 'https://schema.org',
		'@type': 'ProfilePage',
		url: abs(site, `/hosts/${host.slug}/`),
		mainEntity: {
			'@type': 'Person',
			name: host.name,
			jobTitle: 'Film Junk Podcast host',
			sameAs: host.links.map((l) => l.url),
		},
	};
}
