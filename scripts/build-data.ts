// Parses the raw sources in data/raw into src/data/*.json for the site.
// Usage: node scripts/build-data.ts
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { normalizeGuide, decode } from './lib/normalize.ts';
import type {
	Episode,
	Film,
	Mention,
	Meta,
	Pack,
	Rating,
	Review,
	ScheduleMonth,
	TmdbCache,
	TmdbMatch,
	YearEndLists,
} from '../src/lib/types.ts';

// An episode while it's being assembled from the guides, wiki and feed.
type Draft = {
	number: number | null;
	part?: number | null;
	date: string | null;
	dateApprox?: boolean;
	kind: 'regular' | 'bonus';
	link?: string;
	bonusTitle?: string;
	reviews: Review[];
	watched: Mention[];
	segments: { label: string; items: string[] }[];
	music: { intro?: string; outro?: string };
	guideNotes: string[];
	description?: string;
	source: 'guide' | 'wiki' | 'rss';
};

const RAW = 'data/raw';
const OUT = 'src/data';
const read = (p: string) => readFileSync(`${RAW}/${p}`, 'utf8');

// ---------------------------------------------------------------- helpers

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseDate(s: string | null | undefined): string | null {
	if (!s) return null;
	let m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
	if (m) return iso(m[3], MONTHS.indexOf(m[1].toLowerCase()), m[2]);
	m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
	if (m) return iso(m[3], MONTHS.indexOf(m[2].toLowerCase()), m[1]);
	return null;
}

function iso(y: string, monthIndex: number, d: string): string | null {
	if (monthIndex < 0) return null;
	return `${y}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function slugify(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

// "Leviathan (2015)" -> { title: "Leviathan", year: 2015 }
function splitYear(title: string): { title: string; year: number | null } {
	const m = title.match(/^(.*?)\s*\((\d{4})\)\s*$/);
	return m ? { title: m[1].trim(), year: +m[2] } : { title: title.trim(), year: null };
}

// A mention ("what we watched") before it's linked to a film page.
const mention = (title: string): Mention => ({ ...splitYear(title), film: null });

function cleanTitle(s: string): string {
	return s
		.replace(/\s+/g, ' ')
		.replace(/\s+([:,])/g, '$1')
		.replace(/^[-–•*\s]+|[-–\s]+$/g, '')
		// "A Quiet Place (SPOILERS)", "12 Monkeys (with Spoilers)"
		.replace(/\s*\((with )?spoilers?\)$/i, '')
		.trim();
}

function stripHtml(s: string): string {
	return decode(
		s
			.replace(/<br\s*\/?>|<\/p>/g, '\n')
			.replace(/<[^>]+>/g, '')
	)
		.replace(/[ \t ]+/g, ' ')
		.replace(/\n\s*\n+/g, '\n\n')
		.trim();
}

// ---------------------------------------------------------------- libsyn guides

const CHROME = new Set([
	'Preview Mode Links will not work in preview mode',
	'Subscribe:',
	'Support the Show:',
	'Latest Episodes:',
	'About the Podcast',
	'Share This Episode',
	'Private Premium Login',
	'Login',
	'Other Links',
	'Related Links',
	'Comments',
	'|',
	'',
]);
const SECTION_ALIASES: Record<string, string> = { Features: 'Feature', 'Hot Topics': 'Hot Topic', 'In The News': 'Headlines' };
const REVIEW_SECTIONS = /^(movie )?reviews?$|^film junk re-review$|^(tiff|hot docs) reviews$/i;
const WATCHED_SECTIONS = /^(other stuff we watched|what we watched( this week)?|other stuff)$/i;

function parseRatings(s: string): Rating[] {
	const ratings: Rating[] = [];
	for (const m of s.matchAll(/([A-Z][A-Za-z.'&]*(?: [A-Z][A-Za-z.']*)?)\s*:\s*([★½☆]+)/g)) {
		let icons = [...m[2]];
		// Some 2011 guides paste the same 4-star block twice (★★★☆★★★☆).
		const half = icons.length / 2;
		if (icons.length === 8 && icons.slice(0, half).join('') === icons.slice(half).join('')) icons = icons.slice(0, half);
		const score = icons.filter((c) => c === '★').length + (icons.includes('½') ? 0.5 : 0);
		// All-full runs past five are the show's "6 out of 5" (and once, 7 out of 5).
		const outOf = icons.length > 5 && !icons.includes('☆') && !icons.includes('½') ? 5 : icons.length;
		ratings.push({ host: m[1], score, outOf });
	}
	return ratings;
}

function parseReview(line: string): Review {
	const [rawTitle, rest = ''] = line.split(/\s*--\s*/, 2);
	const { title, year } = splitYear(cleanTitle(rawTitle.replace(/[★½☆]+/g, '')));
	return { title, year, ratings: parseRatings(rest), film: null };
}

function parseGuide(year: number): Draft[] {
	const lines = normalizeGuide(read(`guides/${year}.html`));
	const episodes: Draft[] = [];
	let ep: Draft | null = null;
	let section: string | null = null;

	const startEpisode = (props: Pick<Draft, 'number' | 'date' | 'kind'> & Partial<Draft>): Draft => {
		const draft: Draft = { reviews: [], watched: [], segments: [], music: {}, guideNotes: [], source: 'guide', ...props };
		section = null;
		episodes.push(draft);
		return draft;
	};

	for (const line of lines) {
		if (line.startsWith('##')) {
			const link = line.match(/@@(\S+?)@@/)?.[1];
			const text = line.replace(/^##/, '').replace(/@@.*?@@/g, '').trim();
			let m;
			if ((m = text.match(/^Episode\s+#?(\d+)(?:\s*#(\d+))?\s*[-:–]\s*(.*)$/))) {
				ep = startEpisode({ number: +m[1], part: m[2] ? +m[2] : null, date: parseDate(m[3]), kind: 'regular', link });
				continue;
			}
			if ((m = text.match(/^(Bonus (?:Podcasts?|Episode)|Film Junk Top 100 Special)\s*[:\-–]?\s*(.*)$/i))) {
				// Movie Review Show bonuses carry their original 1990s air date; ignore it.
				const parsed = parseDate(m[2]);
				const date = parsed && parsed >= '2005' ? parsed : null;
				const title = m[2].replace(/(?:^|\s*[-–]\s*)[A-Z][a-z]{2,}\.? \d{1,2}(st|nd|rd|th)?, \d{4}\s*$/, '').trim();
				ep = startEpisode({ number: null, date, kind: 'bonus', bonusTitle: title || m[1], link });
				continue;
			}
			if (CHROME.has(text) || /^\d{4} Episodes$/.test(text) || /longest-running|^Preview Mode/.test(text)) {
				// Site chrome after the last episode; stop attaching lines to it.
				ep = null;
				section = null;
				continue;
			}
			if (ep) section = SECTION_ALIASES[text.replace(/:$/, '')] ?? text.replace(/:$/, '');
			continue;
		}
		if (!ep) continue;
		// libsyn's sidebar blurb and share widget, which aren't always under a heading.
		if (/^Long-time friends Sean|^Check out our Patreon page|^Share$|^×$|^&times;$/.test(line)) {
			ep = null;
			continue;
		}
		if (/^@@.*@@$/.test(line)) {
			ep.link ??= line.slice(2, -2);
			continue;
		}
		if (!section) {
			ep.guideNotes.push(line);
		} else if (REVIEW_SECTIONS.test(section)) {
			const r = parseReview(line);
			if (r.title) ep.reviews.push(r);
		} else if (WATCHED_SECTIONS.test(section)) {
			const t = cleanTitle(line);
			if (t) ep.watched.push(mention(t));
		} else if (/^music$/i.test(section)) {
			const m = line.match(/^(Intro|Outro)\s*:\s*(.*)$/i);
			if (m) ep.music[m[1].toLowerCase() as 'intro' | 'outro'] = m[2].trim();
		} else {
			let seg = ep.segments.at(-1);
			if (!seg || seg.label !== section) ep.segments.push((seg = { label: section, items: [] }));
			seg.items.push(line);
		}
	}

	// Undated bonus episodes sit above the episode they followed; borrow its date.
	for (let i = 0; i < episodes.length; i++) {
		if (!episodes[i].date) {
			const next = episodes.slice(i + 1).find((e) => e.date);
			episodes[i].date = next?.date ?? `${year}-01-01`;
			episodes[i].dateApprox = true;
		}
	}
	return episodes;
}

// ---------------------------------------------------------------- fandom wiki

function wikiText(page: string): string {
	return JSON.parse(read(`wiki/${page}.json`)).parse.wikitext['*'];
}

function cleanWiki(s: string): string {
	return decode(
		s
			.replace(/<br\s*\/?>/gi, ' ')
			.replace(/<[^>]+>/g, '')
			.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
			.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1')
			.replace(/'{2,}/g, '')
	)
		.replace(/\s+/g, ' ')
		.trim();
}

function parseWikiTables(text: string): string[][] {
	const rows: string[][] = [];
	for (const table of text.split('{|').slice(1)) {
		const body = table.split('|}')[0];
		for (const chunk of body.split(/\n\|-[^\n]*/).slice(1)) {
			const cells: string[] = [];
			for (const line of chunk.split('\n')) {
				if (line.startsWith('|') && !line.startsWith('|}')) cells.push(line.slice(1));
				else if (line.startsWith('!')) continue;
				else if (cells.length) cells[cells.length - 1] += '\n' + line;
			}
			if (cells.length >= 3) rows.push(cells.map(cleanWiki));
		}
	}
	return rows;
}

function parseWikiOverview(text: string): string[] {
	const m = text.match(/Overview[^\n]*\n([\s\S]*?)(?:\n==|\n\{\|)/);
	if (!m) return [];
	return m[1]
		.split('\n')
		.filter((l) => l.startsWith('*'))
		.map((l) => cleanWiki(l.replace(/^\*+/, '')))
		.filter(Boolean);
}

type WikiEpisode = { number: number; date: string | null; featured: string; notes: string };
const wikiEpisodes = new Map<number, WikiEpisode>();
const yearNotes: Record<string, string[]> = {};
for (const page of ['2005', '2006 (SJ)', 'Episodes', ...Array.from({ length: 14 }, (_, i) => String(2007 + i))]) {
	const text = wikiText(page);
	const overview = parseWikiOverview(text);
	if (overview.length && /^\d{4}$/.test(page)) yearNotes[page] = overview;
	for (const [num, date, featured, notes = ''] of parseWikiTables(text)) {
		const n = parseInt(num, 10);
		if (!Number.isFinite(n)) continue;
		const prev = wikiEpisodes.get(n);
		if (prev && prev.notes.length >= notes.length) continue;
		wikiEpisodes.set(n, { number: n, date: parseDate(date), featured, notes });
	}
}

// ---------------------------------------------------------------- RSS (episodes newer than the guides)

type FeedItem = { title: string; date: string; description: string; link: string; number: number | null };

function parseFeed(xml: string): FeedItem[] {
	return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
		const tag = (name: string) => {
			const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
			return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() : '';
		};
		const enclosure = item.match(/<enclosure url="([^"]+)"/)?.[1] ?? '';
		const pub = new Date(tag('pubDate').replace(/ EST$/, ' -0500'));
		return {
			title: decode(tag('title')),
			date: pub.toISOString().slice(0, 10),
			description: stripHtml(tag('description')),
			link: tag('guid').startsWith('http') ? tag('guid') : tag('link'),
			// Prefer "Episode 1020:" in the title; mp3 filenames are sometimes off by one.
			number:
				+(decode(tag('title')).match(/^Episode (\d+):/)?.[1] ?? enclosure.match(/filmjunk(\d{3,4})\.mp3/i)?.[1] ?? NaN) || null,
		};
	});
}

// ---------------------------------------------------------------- premiums

// Bandcamp album data embedded in each album page (just the fields we use).
type BandcampAlbum = {
	art_id?: number;
	album_release_date?: string;
	current: { title: string; about?: string; release_date?: string };
};

function parsePremiums(): Episode[] {
	const wiki = parseWikiTables(wikiText('Premiums')).map(([num, date, title, notes = '']) => {
		const reviews = notes.match(/Reviews:\s*(.*?)(?:\.\s*$|$)/)?.[1] ?? '';
		return {
			number: parseInt(num, 10) || null,
			date: parseDate(date),
			title,
			notes: notes.replace(/Reviews:.*$/, '').trim(),
			covers: reviews
				.split(/,\s*|\s+\+\s+/)
				.map((s) => cleanTitle(s.replace(/\.$/, '')))
				.filter(Boolean)
				.map((title) => ({ title, film: null })),
		};
	});

	const key = (s: string) => slugify(s.replace(/\b(the|trilogy|saga|franchise|films?|legacy|series)\b/gi, ''));
	const byKey = new Map(wiki.map((w) => [key(w.title), w]));
	const used = new Set<(typeof wiki)[number]>();
	const premiums: Episode[] = [];

	for (const file of readdirSync(`${RAW}/bandcamp`)) {
		if (file === 'index.html') continue;
		const html = read(`bandcamp/${file}`);
		const data = html.match(/data-tralbum="([^"]*)"/);
		if (!data) continue;
		const album: BandcampAlbum = JSON.parse(decode(data[1]));
		const slug = file.replace(/\.html$/, '');
		const title = album.current.title;
		const w = byKey.get(key(title));
		if (w) used.add(w);
		const art = album.art_id ? `https://f4.bcbits.com/img/a${String(album.art_id).padStart(10, '0')}_16.jpg` : null;
		premiums.push({
			id: `premium-${slug}`,
			kind: 'premium',
			number: w?.number ?? null,
			date: new Date(album.album_release_date ?? album.current.release_date ?? '').toISOString().slice(0, 10),
			title,
			description: (album.current.about ?? '').trim(),
			covers: w?.covers ?? [],
			notes: w?.notes ?? '',
			art,
			links: { bandcamp: `https://filmjunk.bandcamp.com/album/${slug}` },
		});
	}

	// Titles often differ between the two ("Alfred Hitcock" vs "Alfred Hitchcock", "Sylvester Stallone" vs
	// "Sylvester Stallone Premium"), but the release dates line up, so pair leftovers released within 2 days.
	const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
	for (const w of wiki) {
		if (used.has(w) || !w.date) continue;
		// Or the same day a year off with a word in common: the wiki has #90 The Godfather in 2021, Bandcamp in 2022.
		const words = (t: string) => new Set(key(t).split('-').filter((x) => x.length > 3));
		const shared = (t: string) => [...words(t)].some((x) => words(w.title).has(x));
		const offByYear = (d: string) => Math.abs(days(d, w.date!) - 365) <= 2;
		const twin = premiums
			.filter((p) => p.number === null && (days(p.date, w.date!) <= 2 || (offByYear(p.date) && shared(p.title))))
			.sort((a, b) => days(a.date, w.date!) - days(b.date, w.date!))[0];
		if (twin) {
			used.add(w);
			Object.assign(twin, { number: w.number, covers: w.covers, notes: w.notes });
		}
	}

	for (const w of wiki) {
		if (used.has(w) || !w.date) continue;
		premiums.push({
			id: `premium-${w.number ? String(w.number).padStart(3, '0') : slugify(w.title)}`,
			kind: 'premium',
			number: w.number,
			date: w.date,
			title: w.title,
			description: '',
			covers: w.covers,
			notes: w.notes,
			art: null,
			links: {},
		});
	}
	return premiums;
}

// ---------------------------------------------------------------- gumroad bundles

// Yearly archive packs ("Episodes #594-640 (2017)", "Space Junk Radio: Episodes #1-55")
// plus the pack of Movie Review Show / Movie Organization Manifesto bonus episodes.
type GumroadProduct = { name: string; url: string; price: number; currency: string };
type Bundle = { name: string; from: number; to: number; url: string };

function parseGumroad(): { bundles: Bundle[]; bonus: string | null } {
	const products: GumroadProduct[] = JSON.parse(read('gumroad.json'));
	const bundles: Bundle[] = [];
	let bonus: string | null = null;
	for (const p of products) {
		const m = p.name.match(/Episodes #?(\d+)-(\d+)/);
		if (m) bundles.push({ name: p.name, from: +m[1], to: +m[2], url: p.url });
		else if (/movie review show|manifesto/i.test(p.name)) bonus = p.url;
	}
	return { bundles, bonus };
}

// ---------------------------------------------------------------- assemble

const guideEpisodes: Draft[] = [];
for (let y = 2006; y <= new Date().getFullYear(); y++) {
	try {
		guideEpisodes.push(...parseGuide(y));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
	}
}

const byNumber = new Map<number, Draft>();
for (const e of guideEpisodes) if (e.number && !e.part) byNumber.set(e.number, e);

// Space Junk / early episodes that only exist on the wiki.
for (const w of wikiEpisodes.values()) {
	if (byNumber.has(w.number) || !w.date) continue;
	const reviews = w.featured
		.split(/\s+\/\s+|\s+\+\s+/)
		.map((t): Review => ({ ...splitYear(cleanTitle(t)), ratings: [], film: null }))
		.filter((r) => r.title && !/^episode \d+!?$|^no feature(d)? review/i.test(r.title));
	const e: Draft = { number: w.number, date: w.date, kind: 'regular', reviews, watched: [], segments: [], music: {}, guideNotes: [], source: 'wiki' };
	guideEpisodes.push(e);
	byNumber.set(w.number, e);
}

const latestGuideDate = guideEpisodes.reduce((max, e) => (e.date && e.date > max ? e.date : max), '');
const maxGuideNumber = Math.max(...byNumber.keys());
// Spin-off shows that occasionally go out on the main feed; kept as bonus episodes.
const SPIN_OFF = /^(game junk|ball junk|tv junk|treknobabble)/i;

for (const item of parseFeed(read('feedburner.xml'))) {
	const known = item.number && byNumber.get(item.number);
	if (known) {
		known.description ??= item.description;
		// The guides occasionally link the wrong episode; the feed's guid is authoritative.
		known.link = item.link;
		continue;
	}
	if (item.date <= latestGuideDate && !(item.number && item.number > maxGuideNumber)) continue;
	const numbered = item.title.match(/^Episode (\d+):\s*(.*)$/);
	const title = numbered ? numbered[2] : item.title;
	const isBonus = SPIN_OFF.test(title) || /calendar reveal|preview|what we watched|livestream/i.test(title);
	const e: Draft = {
		number: isBonus ? null : item.number ?? (numbered ? +numbered[1] : null),
		date: item.date,
		kind: isBonus ? 'bonus' : 'regular',
		bonusTitle: isBonus ? title : undefined,
		reviews: isBonus ? [] : title.split(/\s+\+\s+/).map((t): Review => ({ ...splitYear(t), ratings: [], film: null })),
		watched: [],
		segments: [],
		music: {},
		guideNotes: [],
		description: item.description,
		link: item.link,
		source: 'rss',
	};
	guideEpisodes.push(e);
	if (e.number) byNumber.set(e.number, e);
}

const { bundles: gumroad, bonus: gumroadBonus } = parseGumroad();

function spaceJunk(e: Draft) {
	return !!e.number && e.number <= 55 && !!e.date && e.date < '2006-03-01';
}

const wikiByDate = new Map([...wikiEpisodes.values()].filter((w) => w.date).map((w) => [w.date!, w]));

const episodes = guideEpisodes.map((e): Episode => {
	// Every draft has a date by now: undated guide entries borrow their neighbour's.
	const date = e.date!;
	// The wiki's numbering drifts from the guides in places (its #089 is the guides' #88), so if
	// its date for this number is off, use the wiki entry from the same date instead.
	const byNum = e.number ? wikiEpisodes.get(e.number) : undefined;
	const wiki =
		byNum && byNum.date && e.date && Math.abs(Date.parse(byNum.date) - Date.parse(e.date)) > 3 * 86_400_000
			? (wikiByDate.get(e.date) ?? null)
			: (byNum ?? null);
	const bonusTitle = e.bonusTitle && !/^bonus (episode|podcasts?)$/i.test(e.bonusTitle) ? e.bonusTitle : null;
	const title =
		bonusTitle ??
		(e.reviews.length
			? e.reviews.map((r) => r.title).join(' + ')
			: (!/^no feature(d)? review/i.test(wiki?.featured ?? '') && wiki?.featured) ||
				(e.segments.find((s) => s.label === 'Feature') ?? e.segments[0])?.items[0] ||
				e.guideNotes[0] ||
				// No review or segments: the first sentence of the wiki notes describes it best.
				wiki?.notes.split(/(?<=\.)\s/)[0].replace(/\.$/, '') ||
				(e.kind === 'bonus' ? 'Bonus Episode' : 'No featured review'));
	const id = e.number
		? `${e.number}${e.part ? `-${e.part}` : ''}`
		: `${date}-${slugify(title).slice(0, 50)}`;
	const number = e.number;
	const bundle: { name: string; url: string } | null =
		(number ? gumroad.find((b) => number >= b.from && number <= b.to) : undefined) ??
		(e.kind === 'bonus' && gumroadBonus && /movie review show|manifesto/i.test(e.bonusTitle ?? '') ? { name: 'bonus', url: gumroadBonus } : null);
	// "2017", "Space Junk" or "bonus", for the button label.
	const pack = bundle ? (bundle.name.match(/\((\d{4})\)/)?.[1] ?? (/space junk/i.test(bundle.name) ? 'Space Junk' : 'bonus')) : null;
	const notes = [wiki?.notes, ...e.guideNotes].filter(Boolean).join(' ').trim();
	return {
		id,
		kind: e.kind,
		show: spaceJunk(e) ? 'Space Junk' : 'Film Junk',
		...(e.bonusTitle && SPIN_OFF.test(e.bonusTitle) ? { series: e.bonusTitle.match(SPIN_OFF)![0] } : {}),
		number: e.number,
		part: e.part ?? null,
		date,
		dateApprox: e.dateApprox ?? false,
		title,
		reviews: e.reviews,
		watched: e.watched,
		segments: e.segments,
		music: e.music,
		notes,
		description: e.description ?? '',
		pack,
		links: {
			...(e.link ? { libsyn: e.link } : {}),
			...(bundle ? { gumroad: bundle.url } : {}),
		},
	};
});

const premiums = parsePremiums();
const all = [...episodes, ...premiums].sort((a, b) => b.date.localeCompare(a.date) || (b.number ?? 0) - (a.number ?? 0));

// The guides sometimes paste a neighbour's link; when two episodes share one we
// can't tell which is right, so drop it from both.
const linkCounts = new Map<string, number>();
for (const e of all) if (e.links.libsyn) linkCounts.set(norm(e.links.libsyn), (linkCounts.get(norm(e.links.libsyn)) ?? 0) + 1);
for (const e of all) if (e.links.libsyn && (linkCounts.get(norm(e.links.libsyn)) ?? 0) > 1) delete e.links.libsyn;
function norm(url: string) {
	return url.replace(/\/$/, '');
}

// Guard against duplicate ids (e.g. two bonus episodes on one day).
const seen = new Map<string, number>();
for (const e of all) {
	const n = seen.get(e.id) ?? 0;
	seen.set(e.id, n + 1);
	if (n) e.id += `-${n + 1}`;
}

// ---------------------------------------------------------------- per-episode platform links

const readJson = <T>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null);
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
const titleKey = (s: string) =>
	slugify(
		s
			.replace(/^(film junk (podcast )?)?(episode|ep\.?)\s*#?\d+\s*[:\-–]?\s*/i, '')
			.replace(/^(film junk )?premium( podcast)?\s*(#\d+)?\s*[:\-–]?\s*/i, '')
			.replace(/\(\d{4}\)/g, '')
			// Spotify's copies of Patreon posts: "Junk Mail Bonus Episode: June 2024 Edition (Patreon Exclusive …)".
			.replace(/\((patreon exclusive|audio)[^)]*\)/gi, '')
			.replace(/\s+bonus episode\b|\s+edition\b/gi, '')
	);

const regularByNumber = new Map(all.filter((e) => e.kind === 'regular' && e.number && !e.part).map((e) => [e.number!, e]));
const premiumByNumber = new Map(all.filter((e) => e.kind === 'premium' && e.number).map((e) => [e.number!, e]));
let keyed = all.map((e) => ({ e, key: titleKey(e.title) }));

// Finds the episode a platform item (Spotify episode, Patreon post) refers to.
type PlatformItem = { title: string; date: string; url: string };

function matchEpisode({ title, date }: { title: string; date: string }): Episode | null {
	const number = title.match(/(?:episode|ep\.?)\s*#?(\d{2,4})\b/i)?.[1];
	if (number && regularByNumber.has(+number)) return regularByNumber.get(+number)!;
	// Re-released premiums keep their number: "Film Junk Premium Podcast #18: …".
	const premium = title.match(/premium(?: podcast)?\s*#?(\d{1,3})\s*:/i)?.[1];
	if (premium && premiumByNumber.has(+premium)) return premiumByNumber.get(+premium)!;
	const key = titleKey(title);
	if (key.length < 3) return null;
	const near = (max: number) => keyed.filter(({ e }) => dayDiff(e.date, date) <= max);
	return (
		near(10).find((c) => c.key === key)?.e ??
		// Premiums often go up on Patreon well before Bandcamp.
		near(120).find((c) => c.e.kind === 'premium' && c.key.length > 3 && key.includes(c.key))?.e ??
		null
	);
}

function attach(items: PlatformItem[] | null, platform: 'spotify' | 'patreon') {
	let matched = 0;
	for (const item of items ?? []) {
		const e = matchEpisode(item);
		if (e && !e.links[platform]) {
			e.links[platform] = item.url;
			matched++;
		}
	}
	if (items) console.log(`${platform}: matched ${matched} of ${items.length}`);
}

// ---------------------------------------------------------------- patreon

// From a patron's private feed (sanitised by fetch-sources) or, failing that, the manual export.
// Sanitised posts from a patron's feed, committed by fetch-sources (see fetchPatreonFeed).
type PatreonPost = PlatformItem & { duration?: number | null; description?: string };
const patreonPosts = readJson<PatreonPost[]>('data/patreon.json') ?? [];
// Series whose post title names the film being discussed ("Retro Review: Poultrygeist").
const SERIES_ALIASES: Record<string, string> = { 'Film Junk Tier Ranking': 'Tier Ranking', 'Film Junk Bonus Podcast': 'Bonus Podcast', 'Bonus Clip': 'Bonus Clip' };
const FILM_SERIES = /^(retro review|criterionitis|bonus podcast|re-pre)$/i;
const NOT_A_FILM = /q&a|junkies|livestream|pre-show|discussion|edition|mail|reveal|top 100|celebration|event/i;

type PatreonKind =
	| { type: 'calendar' }
	| { type: 'regular'; number: number; rest: string }
	| { type: 'premium'; rest: string }
	| { type: 'patreon'; series: string; rest: string };

function classifyPatreon(title: string): PatreonKind {
	let m;
	if ((m = title.match(/^Film Junk Podcast Episode #(\d+):\s*(.*)$/i))) return { type: 'regular', number: +m[1], rest: m[2] };
	if ((m = title.match(/^Film Junk Premium (?:Podcast|One-Shot)\s*#?\s*\d*\s*:\s*(.*)$/i))) return { type: 'premium', rest: m[1] };
	if (/calendar reveal/i.test(title)) return { type: 'calendar' };
	const clean = title.replace(/\s*\((patreon exclusive[^)]*|audio)\)/gi, '').replace(/^Film Junk\s+/i, '');
	m = clean.match(/^(.*?)\s*(?::|\s-\s)\s*(.*)$/);
	// "Treknobabble Episode #5" and "Game Junk 168" are the series, not the episode.
	const series = (m ? m[1].trim() : clean).replace(/\s+(bonus episode|livestream)$/i, '').replace(/\s+(episode\s*)?#?\d+$/i, '');
	return { type: 'patreon', series: SERIES_ALIASES[series] ?? series, rest: m ? m[2].trim().replace(/\s+edition$/i, '') : '' };
}

// Films named in a post's description: timestamped chapter lines ("07:20 - Bebe's Kids"),
// "Title (1985)", and titles the show has reviewed quoted word for word.
const NOT_A_CHAPTER =
	/^(this week (on|and) dvd|headlines|going digital|intro|outro|opening|closing|wrap|junk mail|q ?& ?a|questions?|listener|mailbag|news|updates?|announcements?|housekeeping|banter|break|trivia|patreon|tier|top \d+|segment|the rest|misc|other stuff)\b/i;
const SEGMENT_PREFIX = /^(review|retro review|spoiler (discussion|review|talk)|trailer trash|feature review)\s*[:\-–]\s*/i;
const reviewedTitles = [
	// Two or more words, so everyday words that are also titles ("Halloween") don't match.
	...new Set(all.flatMap((e) => (e.reviews ?? []).map((r) => r.title)).filter((t) => t.length >= 8 && /\s/.test(t) && /[A-Z0-9]/.test(t[0]))),
];
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function filmsInDescription(text: string | undefined): Mention[] {
	if (!text) return [];
	const found = new Map<string, Mention>();
	const add = (title: string) => {
		const m = mention(cleanTitle(title.replace(/[.!?:,;]+$/, '')));
		if (m.title.length >= 2 && !found.has(m.title.toLowerCase())) found.set(m.title.toLowerCase(), m);
	};
	for (const line of text.split('\n')) {
		let chapter = line.match(/^\s*\(?\d{1,2}:\d{2}(?::\d{2})?\)?\s*[-–—:]?\s*(.+)$/)?.[1]?.trim();
		if (!chapter || chapter.length > 70 || chapter.includes('?') || NOT_A_CHAPTER.test(chapter)) continue;
		// "What We Watched: Frasier, Lonesome Dove and The Paper" names several.
		const watched = chapter.match(/^what we watched\s*[:\-–]\s*(.+)$/i)?.[1];
		if (watched) {
			for (const t of watched.replace(/,?\s*and\s+(much,?\s+)*more[.!]*$/i, '').split(/,\s*|\s+and\s+/)) add(t);
			continue;
		}
		// Segment prefixes around a title: "Review: Send Help", "Trailer Trash: The Batman".
		chapter = chapter.replace(SEGMENT_PREFIX, '').trim();
		if (chapter && !NOT_A_CHAPTER.test(chapter) && !/\b(discussion|announcements?|trailers?|updates?|news)$/i.test(chapter)) add(chapter);
	}
	const capitalised = String.raw`[A-Z0-9][\w'’&!.-]*`;
	const joiner = String.raw`(?:of|the|and|a|an|in|on|to|at|for|with|from|vs\.?|&|-)`;
	const withYear = new RegExp(String.raw`(${capitalised}(?::?\s+(?:${capitalised}|${joiner})){0,8})\s\(((?:19|20)\d\d)\)`, 'g');
	for (const m of text.matchAll(withYear)) add(`${m[1]} (${m[2]})`);
	const strong = [...found.keys()];
	for (const title of reviewedTitles) {
		// Skip titles that are only part of a longer one already found ("The Hunt" in "…: The Hunt for …").
		if (strong.some((t) => t !== title.toLowerCase() && t.includes(title.toLowerCase()))) continue;
		if (text.includes(title) && new RegExp(String.raw`(^|[^\w])${escapeRegex(title)}($|[^\w])`).test(text)) add(title);
	}
	return [...found.values()];
}

let patreonLinked = 0;
let patreonAdded = 0;
const patreonKey = (s: string) => titleKey(s.replace(/\s*\((patreon exclusive[^)]*|audio)\)/gi, ''));
for (const post of patreonPosts) {
	const c = classifyPatreon(post.title);
	const mentioned = filmsInDescription(post.description);
	const link = (e: Episode) => {
		e.links.patreon ??= post.url;
		if (!e.description && post.description) e.description = post.description;
		if (mentioned.length) {
			const have = new Set((e.mentioned ?? []).map((m) => m.title.toLowerCase()));
			e.mentioned = [...(e.mentioned ?? []), ...mentioned.filter((m) => !have.has(m.title.toLowerCase()))];
		}
		patreonLinked++;
	};
	const add = (e: Pick<Episode, 'id' | 'kind' | 'number' | 'date' | 'title'> & Partial<Episode>): Episode => {
		const episode: Episode = {
			notes: '',
			description: post.description ?? '',
			mentioned,
			segments: [],
			watched: [],
			reviews: [],
			music: {},
			show: 'Film Junk',
			part: null,
			dateApprox: false,
			pack: null,
			...e,
			links: { patreon: post.url },
		};
		all.push(episode);
		patreonAdded++;
		return episode;
	};

	if (c.type === 'regular') {
		const known = regularByNumber.get(c.number);
		if (known) link(known);
		else {
			// On Patreon before the free feed or the guide.
			const reviews = c.rest.split(/\s+\+\s+/).map((t): Review => ({ ...splitYear(t), ratings: [], film: null }));
			const added = add({ id: String(c.number), kind: 'regular', number: c.number, date: post.date, title: reviews.map((r) => r.title).join(' + '), reviews });
			regularByNumber.set(c.number, added);
		}
		continue;
	}

	if (c.type === 'calendar') {
		// Same show as the free-feed calendar reveals, which spell months differently.
		const known = all.find((e) => e.kind === 'bonus' && /calendar reveal/i.test(e.title) && dayDiff(e.date, post.date) <= 3);
		if (known) link(known);
		continue;
	}

	if (c.type === 'premium') {
		const key = patreonKey(c.rest);
		const byNumber = matchEpisode({ title: post.title, date: post.date });
		const known = (byNumber?.kind === 'premium' ? byNumber : undefined) ?? all.find(
			(e) => e.kind === 'premium' && (e.id.startsWith('premium-') && (titleKey(e.title) === key || (key.length > 4 && (key.includes(titleKey(e.title)) || titleKey(e.title).includes(key)))))
		);
		// A numbered premium ("#107") is a real release, so if the title differs from Bandcamp's
		// ("The Planet of the Apes Trilogy" vs "…: The Caesar Trilogy"), take the one released days apart.
		const nearest =
			!known && /#\d+/.test(post.title)
				? all
						.filter((e) => e.kind === 'premium' && !e.links.patreon && dayDiff(e.date, post.date) <= 14)
						.sort((a, b) => dayDiff(a.date, post.date) - dayDiff(b.date, post.date))[0]
				: undefined;
		// A one-shot is about a single film, which then supplies the cover art (see below).
		const covers = /one-shot/i.test(post.title) ? [{ title: c.rest, film: null }] : [];
		if (known ?? nearest) link((known ?? nearest)!);
		else add({ id: `premium-${slugify(c.rest)}`, kind: 'premium', number: null, date: post.date, title: c.rest, covers, art: null });
		continue;
	}

	// Free bonus episodes are on Patreon too (e.g. the calendar reveals); link rather than duplicate.
	const restKey = patreonKey(c.rest || c.series);
	// "Treknobabble: Cause & Effect" can go free years after it was on Patreon; the series name keeps that match specific.
	const fullKey = c.rest ? patreonKey(`${c.series}: ${c.rest}`) : null;
	const known =
		all.find((e) => e.kind === 'bonus' && patreonKey(e.title) === restKey && dayDiff(e.date, post.date) <= 90) ??
		(fullKey && SPIN_OFF.test(c.series) ? all.find((e) => e.kind === 'bonus' && patreonKey(e.title) === fullKey) : undefined) ??
		matchEpisode({ title: c.rest || c.series, date: post.date }) ??
		matchEpisode({ title: post.title, date: post.date });
	if (known) {
		link(known);
		continue;
	}
	const isFilm = FILM_SERIES.test(c.series) && c.rest && !NOT_A_FILM.test(c.rest);
	const watched =
		/^what we watched$/i.test(c.series) &&
		c.rest
			.replace(/,?\s*and\s+(much,?\s+)*more[.!]*$/i, '')
			.split(/,\s*/)
			.map((t) => mention(cleanTitle(t)))
			.filter((w) => w.title);
	add({
		id: `${post.date}-${slugify(post.title).slice(0, 60)}`,
		kind: 'patreon',
		number: null,
		series: c.series,
		date: post.date,
		title: c.rest ? `${c.series}: ${c.rest}` : c.series,
		reviews: isFilm ? [{ ...splitYear(c.rest), ratings: [], film: null }] : [],
		watched: watched || [],
		duration: post.duration,
	});
}
if (patreonPosts.length) {
	all.sort((a, b) => b.date.localeCompare(a.date) || (b.number ?? 0) - (a.number ?? 0));
	console.log(`patreon: linked ${patreonLinked}, added ${patreonAdded} of ${patreonPosts.length} posts`);
}

// ---------------------------------------------------------------- apple and spotify links

// After Patreon, which adds the newest episodes (on Patreon before the guide or free feed),
// so those get their links too.
// Retro episodes go up on Patreon a week or two early as "Film Junk Podcast Episode #1055",
// then reach the free feed as just "Pleasantville (1998)". Fold the free copy into the numbered one.
for (const free of all.filter((e) => e.kind === 'regular' && !e.number && e.links.libsyn)) {
	const key = titleKey(free.title);
	const numbered = all.find(
		(e) => e.kind === 'regular' && e.number && !e.links.libsyn && titleKey(e.title) === key && dayDiff(e.date, free.date) <= 21
	);
	if (!numbered) continue;
	numbered.links = { ...free.links, ...numbered.links };
	numbered.description ||= free.description;
	numbered.duration ??= free.duration;
	// The free release is when most people heard it.
	numbered.date = free.date;
	all.splice(all.indexOf(free), 1);
}

keyed = all.map((e) => ({ e, key: titleKey(e.title) }));

// Apple uses the feed's guid, which is the libsyn link we already have.
type AppleEpisode = { kind: string; trackName: string; trackId: number; trackViewUrl: string; releaseDate: string; episodeGuid: string };
const apple =
	readJson<{ results: AppleEpisode[] }>(`${RAW}/apple.json`)?.results.filter((r) => r.kind === 'podcast-episode') ?? [];
const byLibsyn = new Map(all.filter((e) => e.links.libsyn).map((e) => [e.links.libsyn!, e]));
for (const a of apple) {
	const numbered = /(?:episode|ep\.?)\s*#?\d{2,4}/i.test(a.trackName);
	const byTitle = () => matchEpisode({ title: a.trackName, date: a.releaseDate.slice(0, 10) });
	const e = (numbered && byTitle()) || byLibsyn.get(a.episodeGuid) || byTitle();
	if (e) e.links.apple = a.trackViewUrl.split('?')[0] + `?i=${a.trackId}`;
}
console.log(`apple: matched ${all.filter((e) => e.links.apple).length} of ${apple.length}`);

attach(readJson<PlatformItem[]>(`${RAW}/spotify.json`), 'spotify');

// ---------------------------------------------------------------- film index

// TMDB matches for reviewed films, cached by scripts/fetch-tmdb.ts.
const tmdb = readJson<TmdbCache>('data/tmdb.json') ?? {};
const tmdbOverrides = readJson<TmdbCache>('data/tmdb-overrides.json') ?? {};
const tmdbFor = (r: { title: string; year: number | null }, e: { date: string }): TmdbMatch | null | undefined =>
	r.title.toLowerCase() in tmdbOverrides ? tmdbOverrides[r.title.toLowerCase()] : tmdb[tmdbKey(r.title, r.year, episodeYear(e))];
// Must match key in fetch-tmdb.ts.
const tmdbKey = (title: string, year: number | null, episodeYear: number) =>
	`${title.toLowerCase()}|${year ?? ''}|${year ? '' : episodeYear}`;
const episodeYear = (e: { date: string }) => +e.date.slice(0, 4);

// A film while the index is built; `years` collects the years mentions give it.
type WorkingFilm = Film & { years?: Set<number | null> };
type Identity = { base: string; title: string; year: number | null; years: Set<number>; tmdb: TmdbMatch | null };

// 1. Every reviewed film gets an identity: its TMDB id when matched, else its title slug.
const identities = new Map<string, Identity>();
const reviewIdentity = new Map<Review, string>();
for (const e of all) {
	for (const r of e.reviews ?? []) {
		const base = slugify(r.title);
		if (base.length < 2) continue;
		const tm = tmdbFor(r, e);
		const identity = tm ? `tmdb:${tm.type}:${tm.id}` : `slug:${base}`;
		if (!identities.has(identity))
			identities.set(identity, { base, title: tm?.title ?? r.title, year: tm?.year ?? null, years: new Set(), tmdb: tm ?? null });
		if (r.year) identities.get(identity)!.years.add(r.year);
		reviewIdentity.set(r, identity);
	}
}

// 2. Give each identity a slug; remakes sharing a title get the year appended.
const byBase = Map.groupBy(identities, ([, v]) => v.base);
const films = new Map<string, WorkingFilm>(); // slug -> film
const identitySlug = new Map<string, string>();
for (const [base, group] of byBase) {
	for (const [identity, v] of group) {
		let slug = base;
		if (group.length > 1 && v.tmdb) slug = v.year ? `${base}-${v.year}` : `${base}-${v.tmdb.id}`;
		while (films.has(slug)) slug += `-${v.tmdb?.id ?? 2}`;
		identitySlug.set(identity, slug);
		films.set(slug, {
			slug,
			title: v.title,
			year: v.year ?? (v.years.size === 1 ? [...v.years][0] : null),
			poster: v.tmdb?.poster ?? null,
			votes: v.tmdb?.votes ?? 0,
			tmdb: v.tmdb ? { type: v.tmdb.type, id: v.tmdb.id } : null,
			imdb: v.tmdb?.imdb ?? null,
			appearances: [],
		});
	}
}

// 3. Mentions (what they watched, premium covers) only have a title, so pick the
// film with that title that's the most plausible for when it came up.
function resolveMention(title: string, year: number | null, e: Episode): string | null {
	const base = slugify(title);
	if (base.length < 2) return null;
	const group = byBase.get(base);
	const mentionOnly = (slug: string) => {
		if (!films.has(slug)) {
			// Exact-title TMDB match for a film only mentioned in passing (see fetch-tmdb lookupMention).
			const tm = tmdb[`m|${title.toLowerCase()}|${year ?? ''}`] ?? null;
			films.set(slug, {
				slug,
				title,
				year: year ?? tm?.year ?? null,
				poster: tm?.poster ?? null,
				votes: tm?.votes ?? 0,
				tmdb: tm ? { type: tm.type, id: tm.id } : null,
				imdb: tm?.imdb ?? null,
				appearances: [],
				years: new Set(),
			});
		}
		films.get(slug)!.years?.add(year);
		return slug;
	};
	if (!group) return mentionOnly(base);
	const candidates = group.map(([identity, v]) => ({ slug: identitySlug.get(identity)!, year: v.year ?? 0 }));
	if (year) {
		const exact = candidates.find((c) => c.year === year);
		if (exact) return exact.slug;
		// "Dune (1984)" when only the 2021 Dune was reviewed: a different film.
		if (candidates.every((c) => c.year)) return mentionOnly(`${base}-${year}`);
	}
	if (candidates.length === 1) return candidates[0].slug;
	const before = candidates.filter((c) => c.year <= episodeYear(e)).sort((a, b) => b.year - a.year);
	return (before[0] ?? candidates.sort((a, b) => a.year - b.year)[0]).slug;
}

function appear(slug: string | null, e: Episode, role: 'review' | 'watched' | 'premium') {
	const f = slug && films.get(slug);
	if (f && !f.appearances.some((a) => a.id === e.id && a.role === role)) f.appearances.push({ id: e.id, role });
}

for (const e of all) {
	for (const r of e.reviews ?? []) {
		const identity = reviewIdentity.get(r);
		r.film = (identity && identitySlug.get(identity)) ?? null;
		appear(r.film, e, 'review');
	}
	for (const w of e.watched ?? []) {
		w.film = resolveMention(w.title, w.year, e);
		appear(w.film, e, 'watched');
	}
	// Films named in the description, minus ones this episode already reviews or lists.
	if (e.mentioned) {
		const listed = new Set([...(e.reviews ?? []), ...(e.watched ?? [])].map((x) => slugify(x.title)));
		e.mentioned = e.mentioned.filter((m) => !listed.has(slugify(m.title)));
		for (const m of e.mentioned) {
			m.film = resolveMention(m.title, m.year, e);
			appear(m.film, e, 'watched');
		}
	}
	if (e.covers)
		e.covers = e.covers.map((c) => {
			const { title, year } = splitYear(c.title);
			const film = resolveMention(title, year, e);
			appear(film, e, 'premium');
			return { title: c.title, film };
		});
}

// Mention-only titles: show a year only when every mention agrees on it.
for (const f of films.values()) {
	if (f.years) {
		f.years.delete(null);
		// Mentions that agree on a year win; otherwise keep the TMDB year, if matched.
		f.year = f.years.size === 1 ? [...f.years][0] : f.years.size === 0 && f.tmdb ? f.year : null;
		delete f.years;
	}
}
for (const [slug, f] of films) if (!f.appearances.length) films.delete(slug);

// ---------------------------------------------------------------- year in review

// Year-end shows (top 10 lists, the Junkies) usually air the following January.
const YEAR_END = /\b(top 10|top ten|best( and worst)?|worst) (movies|films) of (\d{4})\b|\b((?:19|20)\d\d) junkies\b|\bannual junkies\b|junkers' choice/i;
const yearEnd: Meta['yearEnd'] = {};
for (const e of all) {
	if (e.kind === 'premium' || e.kind === 'patreon') continue;
	const segmentLines = (e.segments ?? []).filter((s) => s.label !== 'Headlines').flatMap((s) => s.items);
	const lines = [e.title, ...segmentLines].filter((l) => YEAR_END.test(l));
	if (!lines.length) continue;
	const stated = lines.map((l) => l.match(/\b(20\d\d|19\d\d)\b/)?.[1]).find(Boolean);
	const d = new Date(e.date);
	const year = stated ?? String(d.getUTCMonth() <= 1 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());
	(yearEnd[year] ??= []).push({ id: e.id, segments: [...new Set(lines.filter((l) => l !== e.title))] });
}

// Patreon-only premiums have no Bandcamp cover; use the poster of the film they cover.
for (const e of all)
	if (e.kind === 'premium' && !e.art) {
		const slug = e.covers?.find((c) => c.film)?.film;
		const poster = slug ? films.get(slug)?.poster : null;
		if (poster) e.art = `https://image.tmdb.org/t/p/w500${poster}`;
	}

// ---------------------------------------------------------------- gumroad packs

// Each pack's cover shows the posters of the biggest (most-rated on TMDB) films reviewed in it.
const products: GumroadProduct[] = JSON.parse(read('gumroad.json'));
const packs: Pack[] = products
	.map((p): Pack | null => {
		const range = p.name.match(/Episodes #?(\d+)-(\d+)/);
		const isBonus = !range && /movie review show|manifesto/i.test(p.name);
		if (!range && !isBonus) return null;
		const inPack = all.filter((e) =>
			range ? e.kind === 'regular' && !!e.number && e.number >= +range[1] && e.number <= +range[2] : e.pack === 'bonus'
		);
		const slugs = new Set(inPack.flatMap((e) => (e.reviews ?? []).map((r) => r.film)));
		const label = p.name.match(/\((\d{4})\)/)?.[1] ?? (/space junk/i.test(p.name) ? 'Space Junk' : 'Bonus shows');
		// That year's releases first (and the tail of the year before), so retro reviews like
		// The Shawshank Redemption don't end up on the 2021 cover.
		const year = /^\d{4}$/.test(label) ? +label : null;
		const current = (f: WorkingFilm) => year !== null && f.year !== null && f.year >= year - 1 && f.year <= year;
		const reviewed = [...slugs]
			.map((slug) => (slug ? films.get(slug) : undefined))
			.filter((f): f is WorkingFilm & { poster: string } => !!f?.poster)
			.sort((a, b) => Number(current(b)) - Number(current(a)) || (b.votes ?? 0) - (a.votes ?? 0));
		return {
			label,
			name: p.name.replace(/^Film Junk Podcast:\s*/, ''),
			url: p.url,
			price: p.price,
			currency: p.currency,
			from: range ? +range[1] : null,
			to: range ? +range[2] : null,
			episodes: inPack.length,
			covers: reviewed.slice(0, 4).map((f) => ({ title: f.title, poster: f.poster })),
		};
	})
	.filter((p): p is Pack => p !== null)
	.sort((a, b) => (b.from ?? -1) - (a.from ?? -1));

// ---------------------------------------------------------------- monthly schedule

// Transcribed from the calendars on Instagram. Each item is matched to its episode once it's out
// (retro episodes land on Patreon a week early).
type ScheduleFile = Record<string, { source?: string; note?: string; items: { date: string; title: string; year: number | null }[] }>;
const scheduleData = readJson<ScheduleFile>('data/schedule.json') ?? {};
const schedule: ScheduleMonth[] = Object.entries(scheduleData)
	.filter(([month]) => /^\d{4}-\d{2}$/.test(month))
	.map(([month, m]) => ({
		month,
		source: m.source ?? null,
		note: m.note ?? null,
		items: m.items.map((item): ScheduleMonth['items'][number] => {
			const key = titleKey(item.title);
			const episode = all.find(
				(e) =>
					(e.kind === 'regular' || e.kind === 'patreon') &&
					dayDiff(e.date, item.date) <= 14 &&
					(e.reviews ?? []).some((r) => titleKey(r.title) === key)
			);
			const review = episode?.reviews?.find((r) => titleKey(r.title) === key);
			const film = review?.film ? films.get(review.film) : null;
			const tm = tmdbFor({ title: item.title, year: item.year }, { date: item.date });
			// Not Spotify: it also carries patron-only episodes, so a link there doesn't mean it's free.
			const free = episode && (episode.links.libsyn || episode.links.apple);
			return {
				...item,
				episode: episode?.id ?? null,
				film: film?.slug ?? null,
				poster: film?.poster ?? tm?.poster ?? null,
				status: !episode ? 'upcoming' : free ? 'out' : 'patreon',
			};
		}),
	}))
	.sort((a, b) => b.month.localeCompare(a.month));

// Hand-entered lists and awards, keyed by year (see data/year-end.json).
const yearEndLists = readJson<Record<string, YearEndLists>>('data/year-end.json') ?? {};

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/episodes.json`, JSON.stringify(all, null, '\t'));
writeFileSync(`${OUT}/films.json`, JSON.stringify([...films.values()] satisfies Film[], null, '\t'));
const meta: Meta = { builtAt: new Date().toISOString(), yearNotes, gumroad, yearEnd, yearEndLists, packs, schedule };
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, '\t'));

const count = (k: Episode['kind']) => all.filter((e) => e.kind === k).length;
console.log(
	`episodes: ${count('regular')} regular, ${count('bonus')} bonus, ${count('premium')} premium; films: ${films.size} (${[...films.values()].filter((f) => f.appearances.some((a) => a.role !== 'watched')).length} reviewed, ${[...films.values()].filter((f) => f.tmdb).length} on TMDB)`
);
