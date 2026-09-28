// Shapes of the generated data in src/data/*.json. Shared by the data scripts (which
// write them) and the site (which reads them), so a parser change that breaks a page
// fails the type check instead of rendering a blank field.

export type Rating = { host: string; score: number; outOf: number };
export type Review = { title: string; year: number | null; ratings: Rating[]; film: string | null };
export type Mention = { title: string; year: number | null; film: string | null };
export type Kind = 'regular' | 'bonus' | 'premium' | 'patreon';

export type Links = {
	libsyn?: string;
	gumroad?: string;
	bandcamp?: string;
	apple?: string;
	spotify?: string;
	patreon?: string;
};

export type Episode = {
	id: string;
	kind: Kind;
	show?: string;
	series?: string; // Patreon exclusives: 'Junk Mail', 'Retro Review', ...
	duration?: number | null; // seconds
	number: number | null;
	part?: number | null;
	date: string; // YYYY-MM-DD
	dateApprox?: boolean;
	title: string;
	reviews?: Review[];
	watched?: Mention[];
	mentioned?: Mention[]; // films named in a Patreon post's description
	segments?: { label: string; items: string[] }[];
	music?: { intro?: string; outro?: string };
	notes: string;
	description: string;
	pack?: string | null; // Gumroad pack: '2017', 'Space Junk' or 'bonus'
	covers?: { title: string; film: string | null }[]; // premiums
	art?: string | null; // premiums: Bandcamp cover
	links: Links;
};

export type Appearance = { id: string; role: 'review' | 'watched' | 'premium' };

export type TmdbRef = { type: 'movie' | 'tv'; id: number };

// A cached TMDB match (data/tmdb.json); null means "looked up, nothing found".
export type TmdbMatch = TmdbRef & { title: string; year: number | null; poster: string | null; votes?: number; imdb?: string | null };
export type TmdbCache = Record<string, TmdbMatch | null>;

export type Film = {
	slug: string;
	title: string;
	year: number | null;
	poster: string | null;
	votes?: number; // TMDB vote count, for picking a year's biggest films
	tmdb: TmdbRef | null;
	imdb?: string | null; // IMDb id, e.g. tt1160419
	appearances: Appearance[];
};

export type YearEndLists = {
	top10?: Record<string, string[]>; // each host's ranked list
	junkies?: { award: string; winner: string }[];
	source?: string;
};

export type Pack = {
	label: string;
	name: string;
	url: string;
	price: number;
	currency: string;
	from: number | null;
	to: number | null;
	episodes: number;
	covers: { title: string; poster: string }[];
};

export type ScheduleItem = {
	date: string;
	title: string;
	year: number | null;
	episode: string | null;
	film: string | null;
	poster: string | null;
	status: 'out' | 'patreon' | 'upcoming';
};

export type ScheduleMonth = {
	month: string; // YYYY-MM
	source: string | null;
	note: string | null;
	items: ScheduleItem[];
};

export type Meta = {
	builtAt: string;
	yearNotes: Record<string, string[]>;
	gumroad: { name: string; from: number; to: number; url: string }[];
	yearEnd: Record<string, { id: string; segments: string[] }[]>;
	yearEndLists: Record<string, YearEndLists>;
	packs: Pack[];
	schedule: ScheduleMonth[];
};

// Search index row: [slug, title, year, reviews, mentions]
export type SearchRow = [slug: string, title: string, year: number, reviews: number, mentions: number];
