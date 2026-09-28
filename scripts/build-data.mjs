// Parses the raw sources in data/raw into src/data/*.json for the site.
// Usage: node scripts/build-data.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { normalizeGuide, decode } from './lib/normalize.mjs';

const RAW = 'data/raw';
const OUT = 'src/data';
const read = (p) => readFileSync(`${RAW}/${p}`, 'utf8');

// ---------------------------------------------------------------- helpers

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseDate(s) {
	if (!s) return null;
	let m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
	if (m) return iso(m[3], MONTHS.indexOf(m[1].toLowerCase()), m[2]);
	m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
	if (m) return iso(m[3], MONTHS.indexOf(m[2].toLowerCase()), m[1]);
	return null;
}

function iso(y, monthIndex, d) {
	if (monthIndex < 0) return null;
	return `${y}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function slugify(s) {
	return s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

// "Leviathan (2015)" -> { title: "Leviathan", year: 2015 }
function splitYear(title) {
	const m = title.match(/^(.*?)\s*\((\d{4})\)\s*$/);
	return m ? { title: m[1].trim(), year: +m[2] } : { title: title.trim(), year: null };
}

function cleanTitle(s) {
	return s
		.replace(/\s+/g, ' ')
		.replace(/\s+([:,])/g, '$1')
		.replace(/^[-–•*\s]+|[-–\s]+$/g, '')
		.trim();
}

function stripHtml(s) {
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
const SECTION_ALIASES = { Features: 'Feature', 'Hot Topics': 'Hot Topic', 'In The News': 'Headlines' };
const REVIEW_SECTIONS = /^(movie )?reviews?$|^film junk re-review$|^(tiff|hot docs) reviews$/i;
const WATCHED_SECTIONS = /^(other stuff we watched|what we watched( this week)?|other stuff)$/i;

function parseRatings(s) {
	const ratings = [];
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

function parseReview(line) {
	const [rawTitle, rest = ''] = line.split(/\s*--\s*/, 2);
	const { title, year } = splitYear(cleanTitle(rawTitle.replace(/[★½☆]+/g, '')));
	return { title, year, ratings: parseRatings(rest) };
}

function parseGuide(year) {
	const lines = normalizeGuide(read(`guides/${year}.html`));
	const episodes = [];
	let ep = null;
	let section = null;

	const startEpisode = (props) => {
		ep = {
			...props,
			reviews: [],
			watched: [],
			segments: [],
			music: {},
			guideNotes: [],
			source: 'guide',
		};
		section = null;
		episodes.push(ep);
	};

	for (const line of lines) {
		if (line.startsWith('##')) {
			const link = line.match(/@@(\S+?)@@/)?.[1];
			const text = line.replace(/^##/, '').replace(/@@.*?@@/g, '').trim();
			let m;
			if ((m = text.match(/^Episode\s+#?(\d+)(?:\s*#(\d+))?\s*[-:–]\s*(.*)$/))) {
				startEpisode({ number: +m[1], part: m[2] ? +m[2] : null, date: parseDate(m[3]), kind: 'regular', link });
				continue;
			}
			if ((m = text.match(/^(Bonus (?:Podcasts?|Episode)|Film Junk Top 100 Special)\s*[:\-–]?\s*(.*)$/i))) {
				// Movie Review Show bonuses carry their original 1990s air date; ignore it.
				const parsed = parseDate(m[2]);
				const date = parsed && parsed >= '2005' ? parsed : null;
				const title = m[2].replace(/(?:^|\s*[-–]\s*)[A-Z][a-z]{2,}\.? \d{1,2}(st|nd|rd|th)?, \d{4}\s*$/, '').trim();
				startEpisode({ number: null, date, kind: 'bonus', bonusTitle: title || m[1], link });
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
			if (t) ep.watched.push(splitYear(t));
		} else if (/^music$/i.test(section)) {
			const m = line.match(/^(Intro|Outro)\s*:\s*(.*)$/i);
			if (m) ep.music[m[1].toLowerCase()] = m[2].trim();
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

function wikiText(page) {
	return JSON.parse(read(`wiki/${page}.json`)).parse.wikitext['*'];
}

function cleanWiki(s) {
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

function parseWikiTables(text) {
	const rows = [];
	for (const table of text.split('{|').slice(1)) {
		const body = table.split('|}')[0];
		for (const chunk of body.split(/\n\|-[^\n]*/).slice(1)) {
			const cells = [];
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

function parseWikiOverview(text) {
	const m = text.match(/Overview[^\n]*\n([\s\S]*?)(?:\n==|\n\{\|)/);
	if (!m) return [];
	return m[1]
		.split('\n')
		.filter((l) => l.startsWith('*'))
		.map((l) => cleanWiki(l.replace(/^\*+/, '')))
		.filter(Boolean);
}

const wikiEpisodes = new Map();
const yearNotes = {};
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

function parseFeed(xml) {
	return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
		const tag = (name) => {
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

function parsePremiums() {
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
				.filter(Boolean),
		};
	});

	const key = (s) => slugify(s.replace(/\b(the|trilogy|saga|franchise|films?|legacy|series)\b/gi, ''));
	const byKey = new Map(wiki.map((w) => [key(w.title), w]));
	const used = new Set();
	const premiums = [];

	for (const file of readdirSync(`${RAW}/bandcamp`)) {
		if (file === 'index.html') continue;
		const html = read(`bandcamp/${file}`);
		const data = html.match(/data-tralbum="([^"]*)"/);
		if (!data) continue;
		const album = JSON.parse(decode(data[1]));
		const slug = file.replace(/\.html$/, '');
		const title = album.current.title;
		const w = byKey.get(key(title));
		if (w) used.add(w);
		const art = album.art_id ? `https://f4.bcbits.com/img/a${String(album.art_id).padStart(10, '0')}_16.jpg` : null;
		premiums.push({
			id: `premium-${slug}`,
			kind: 'premium',
			number: w?.number ?? null,
			date: new Date(album.album_release_date ?? album.current.release_date).toISOString().slice(0, 10),
			title,
			description: (album.current.about ?? '').trim(),
			covers: w?.covers ?? [],
			notes: w?.notes ?? '',
			art,
			links: { bandcamp: `https://filmjunk.bandcamp.com/album/${slug}` },
		});
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
function parseGumroad() {
	const products = JSON.parse(read('gumroad.json'));
	const bundles = [];
	let bonus = null;
	for (const p of products) {
		const m = p.name.match(/Episodes #?(\d+)-(\d+)/);
		if (m) bundles.push({ name: p.name, from: +m[1], to: +m[2], url: p.url });
		else if (/movie review show|manifesto/i.test(p.name)) bonus = p.url;
	}
	return { bundles, bonus };
}

// ---------------------------------------------------------------- assemble

const guideEpisodes = [];
for (let y = 2006; y <= new Date().getFullYear(); y++) {
	try {
		guideEpisodes.push(...parseGuide(y));
	} catch (e) {
		if (e.code !== 'ENOENT') throw e;
	}
}

const byNumber = new Map();
for (const e of guideEpisodes) if (e.number && !e.part) byNumber.set(e.number, e);

// Space Junk / early episodes that only exist on the wiki.
for (const w of wikiEpisodes.values()) {
	if (byNumber.has(w.number) || !w.date) continue;
	const reviews = w.featured
		.split(/\s+\/\s+|\s+\+\s+/)
		.map((t) => ({ ...splitYear(cleanTitle(t)), ratings: [] }))
		.filter((r) => r.title && !/^episode \d+!?$|^no feature(d)? review/i.test(r.title));
	const e = { number: w.number, date: w.date, kind: 'regular', reviews, watched: [], segments: [], music: {}, guideNotes: [], source: 'wiki' };
	guideEpisodes.push(e);
	byNumber.set(w.number, e);
}

const latestGuideDate = guideEpisodes.reduce((max, e) => (e.date > max ? e.date : max), '');
const maxGuideNumber = Math.max(...byNumber.keys());
const SPIN_OFF = /^(game junk|ball junk|tv junk|treknobabble)/i;

for (const item of parseFeed(read('feedburner.xml'))) {
	if (SPIN_OFF.test(item.title)) continue;
	const known = item.number && byNumber.get(item.number);
	if (known) {
		known.description ??= item.description;
		// The guides occasionally link the wrong episode; the feed's guid is authoritative.
		known.link = item.link;
		continue;
	}
	if (item.date <= latestGuideDate && !(item.number > maxGuideNumber)) continue;
	const numbered = item.title.match(/^Episode (\d+):\s*(.*)$/);
	const title = numbered ? numbered[2] : item.title;
	const isBonus = /calendar reveal|preview|what we watched|livestream/i.test(title);
	const e = {
		number: isBonus ? null : item.number ?? (numbered ? +numbered[1] : null),
		date: item.date,
		kind: isBonus ? 'bonus' : 'regular',
		bonusTitle: isBonus ? title : undefined,
		reviews: isBonus ? [] : title.split(/\s+\+\s+/).map((t) => ({ ...splitYear(t), ratings: [] })),
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

function spaceJunk(e) {
	return e.number && e.number <= 55 && e.date < '2006-03-01';
}

const episodes = guideEpisodes.map((e) => {
	const wiki = e.number ? wikiEpisodes.get(e.number) : null;
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
		: `${e.date}-${slugify(title).slice(0, 50)}`;
	const bundle =
		(e.number && gumroad.find((b) => e.number >= b.from && e.number <= b.to)) ||
		(e.kind === 'bonus' && gumroadBonus && /movie review show|manifesto/i.test(e.bonusTitle ?? '') && { name: 'bonus', url: gumroadBonus });
	// "2017", "Space Junk" or "bonus", for the button label.
	const pack = bundle ? (bundle.name.match(/\((\d{4})\)/)?.[1] ?? (/space junk/i.test(bundle.name) ? 'Space Junk' : 'bonus')) : null;
	const notes = [wiki?.notes, ...e.guideNotes].filter(Boolean).join(' ').trim();
	return {
		id,
		kind: e.kind,
		show: spaceJunk(e) ? 'Space Junk' : 'Film Junk',
		number: e.number,
		part: e.part ?? null,
		date: e.date,
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
const linkCounts = new Map();
for (const e of all) if (e.links.libsyn) linkCounts.set(norm(e.links.libsyn), (linkCounts.get(norm(e.links.libsyn)) ?? 0) + 1);
for (const e of all) if (e.links.libsyn && linkCounts.get(norm(e.links.libsyn)) > 1) delete e.links.libsyn;
function norm(url) {
	return url.replace(/\/$/, '');
}

// Guard against duplicate ids (e.g. two bonus episodes on one day).
const seen = new Map();
for (const e of all) {
	const n = seen.get(e.id) ?? 0;
	seen.set(e.id, n + 1);
	if (n) e.id += `-${n + 1}`;
}

// ---------------------------------------------------------------- per-episode platform links

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const dayDiff = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
const titleKey = (s) =>
	slugify(
		s
			.replace(/^(film junk (podcast )?)?(episode|ep\.?)\s*#?\d+\s*[:\-–]?\s*/i, '')
			.replace(/^(film junk )?premium( podcast)?\s*(#\d+)?\s*[:\-–]?\s*/i, '')
			.replace(/\(\d{4}\)/g, '')
	);

const regularByNumber = new Map(all.filter((e) => e.kind === 'regular' && e.number && !e.part).map((e) => [e.number, e]));
const keyed = all.map((e) => ({ e, key: titleKey(e.title) }));

// Finds the episode a platform item (Spotify episode, Patreon post) refers to.
function matchEpisode({ title, date }) {
	const number = title.match(/(?:episode|ep\.?)\s*#?(\d{2,4})\b/i)?.[1];
	if (number && regularByNumber.has(+number)) return regularByNumber.get(+number);
	const key = titleKey(title);
	if (key.length < 3) return null;
	const near = (max) => keyed.filter(({ e }) => dayDiff(e.date, date) <= max);
	return (
		near(10).find((c) => c.key === key)?.e ??
		// Premiums often go up on Patreon well before Bandcamp.
		near(120).find((c) => c.e.kind === 'premium' && c.key.length > 3 && key.includes(c.key))?.e ??
		null
	);
}

function attach(items, platform) {
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

// Apple uses the feed's guid, which is the libsyn link we already have.
const apple = readJson(`${RAW}/apple.json`)?.results.filter((r) => r.kind === 'podcast-episode') ?? [];
const byLibsyn = new Map(all.filter((e) => e.links.libsyn).map((e) => [e.links.libsyn, e]));
for (const a of apple) {
	const numbered = /(?:episode|ep\.?)\s*#?\d{2,4}/i.test(a.trackName);
	const byTitle = () => matchEpisode({ title: a.trackName, date: a.releaseDate.slice(0, 10) });
	const e = (numbered && byTitle()) || byLibsyn.get(a.episodeGuid) || byTitle();
	if (e) e.links.apple = a.trackViewUrl.split('?')[0] + `?i=${a.trackId}`;
}
console.log(`apple: matched ${all.filter((e) => e.links.apple).length} of ${apple.length}`);

attach(readJson(`${RAW}/spotify.json`), 'spotify');
// ---------------------------------------------------------------- patreon

// From a patron's private feed (sanitised by fetch-sources) or, failing that, the manual export.
const patreonPosts = readJson(`${RAW}/patreon-feed.json`) ?? readJson('data/patreon-posts.json') ?? [];
// Series whose post title names the film being discussed ("Retro Review: Poultrygeist").
const SERIES_ALIASES = { 'Film Junk Tier Ranking': 'Tier Ranking', 'Film Junk Bonus Podcast': 'Bonus Podcast', 'Bonus Clip': 'Bonus Clip' };
const FILM_SERIES = /^(retro review|criterionitis|bonus podcast|re-pre)$/i;
const NOT_A_FILM = /q&a|junkies|livestream|pre-show|discussion|edition|mail|reveal|top 100|celebration|event/i;

function classifyPatreon(title) {
	if (/^(treknobabble|game junk)/i.test(title)) return { type: 'skip' };
	let m;
	if ((m = title.match(/^Film Junk Podcast Episode #(\d+):\s*(.*)$/i))) return { type: 'regular', number: +m[1], rest: m[2] };
	if ((m = title.match(/^Film Junk Premium (?:Podcast|One-Shot)\s*#?\s*\d*\s*:\s*(.*)$/i))) return { type: 'premium', rest: m[1] };
	if (/calendar reveal/i.test(title)) return { type: 'calendar' };
	const clean = title.replace(/\s*\((patreon exclusive[^)]*|audio)\)/gi, '').replace(/^Film Junk\s+/i, '');
	m = clean.match(/^(.*?)\s*(?::|\s-\s)\s*(.*)$/);
	const series = (m ? m[1].trim() : clean).replace(/\s+(bonus episode|livestream)$/i, '');
	return { type: 'patreon', series: SERIES_ALIASES[series] ?? series, rest: m ? m[2].trim().replace(/\s+edition$/i, '') : '' };
}

let patreonLinked = 0;
let patreonAdded = 0;
const patreonKey = (s) => titleKey(s.replace(/\s*\((patreon exclusive[^)]*|audio)\)/gi, ''));
for (const post of patreonPosts) {
	const c = classifyPatreon(post.title);
	if (c.type === 'skip') continue;
	const link = (e) => {
		e.links.patreon ??= post.url;
		patreonLinked++;
	};
	const add = (e) => {
		all.push({ notes: '', description: '', segments: [], watched: [], reviews: [], music: {}, show: 'Film Junk', part: null, dateApprox: false, pack: null, ...e, links: { patreon: post.url } });
		patreonAdded++;
	};

	if (c.type === 'regular') {
		const known = regularByNumber.get(c.number);
		if (known) link(known);
		else {
			// On Patreon before the free feed or the guide.
			const reviews = c.rest.split(/\s+\+\s+/).map((t) => ({ ...splitYear(t), ratings: [] }));
			add({ id: String(c.number), kind: 'regular', number: c.number, date: post.date, title: reviews.map((r) => r.title).join(' + '), reviews });
			regularByNumber.set(c.number, all.at(-1));
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
		const known = all.find(
			(e) => e.kind === 'premium' && (e.id.startsWith('premium-') && (titleKey(e.title) === key || (key.length > 4 && (key.includes(titleKey(e.title)) || titleKey(e.title).includes(key)))))
		);
		if (known) link(known);
		else add({ id: `premium-${slugify(c.rest)}`, kind: 'premium', number: null, date: post.date, title: c.rest, covers: [], art: null });
		continue;
	}

	// Free bonus episodes are on Patreon too (e.g. the calendar reveals); link rather than duplicate.
	const restKey = patreonKey(c.rest || c.series);
	const known =
		all.find((e) => e.kind === 'bonus' && patreonKey(e.title) === restKey && dayDiff(e.date, post.date) <= 90) ??
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
			.map((t) => splitYear(cleanTitle(t)))
			.filter((w) => w.title);
	add({
		id: `${post.date}-${slugify(post.title).slice(0, 60)}`,
		kind: 'patreon',
		number: null,
		series: c.series,
		date: post.date,
		title: c.rest ? `${c.series}: ${c.rest}` : c.series,
		reviews: isFilm ? [{ ...splitYear(c.rest), ratings: [] }] : [],
		watched: watched || [],
		duration: post.duration,
	});
}
if (patreonPosts.length) {
	all.sort((a, b) => b.date.localeCompare(a.date) || (b.number ?? 0) - (a.number ?? 0));
	console.log(`patreon: linked ${patreonLinked}, added ${patreonAdded} of ${patreonPosts.length} posts`);
}

// ---------------------------------------------------------------- film index

// TMDB matches for reviewed films, cached by scripts/fetch-tmdb.mjs.
const tmdb = readJson('data/tmdb.json') ?? {};
const tmdbOverrides = readJson('data/tmdb-overrides.json') ?? {};
const tmdbFor = (r, e) => (r.title.toLowerCase() in tmdbOverrides ? tmdbOverrides[r.title.toLowerCase()] : tmdb[tmdbKey(r.title, r.year, episodeYear(e))]);
// Must match key in fetch-tmdb.mjs.
const tmdbKey = (title, year, episodeYear) => `${title.toLowerCase()}|${year ?? ''}|${year ? '' : episodeYear}`;
const episodeYear = (e) => +e.date.slice(0, 4);

// 1. Every reviewed film gets an identity: its TMDB id when matched, else its title slug.
const identities = new Map(); // identity -> { base, title, year, years, tmdb }
const reviewIdentity = new Map(); // review object -> identity
for (const e of all) {
	for (const r of e.reviews ?? []) {
		const base = slugify(r.title);
		if (base.length < 2) continue;
		const tm = tmdbFor(r, e);
		const identity = tm ? `tmdb:${tm.type}:${tm.id}` : `slug:${base}`;
		if (!identities.has(identity))
			identities.set(identity, { base, title: tm?.title ?? r.title, year: tm?.year ?? null, years: new Set(), tmdb: tm ?? null });
		if (r.year) identities.get(identity).years.add(r.year);
		reviewIdentity.set(r, identity);
	}
}

// 2. Give each identity a slug; remakes sharing a title get the year appended.
const byBase = Map.groupBy(identities, ([, v]) => v.base);
const films = new Map(); // slug -> film
const identitySlug = new Map();
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
			appearances: [],
		});
	}
}

// 3. Mentions (what they watched, premium covers) only have a title, so pick the
// film with that title that's the most plausible for when it came up.
function resolveMention(title, year, e) {
	const base = slugify(title);
	if (base.length < 2) return null;
	const group = byBase.get(base);
	const mentionOnly = (slug) => {
		if (!films.has(slug)) films.set(slug, { slug, title, year, poster: null, tmdb: null, appearances: [], years: new Set() });
		films.get(slug).years?.add(year);
		return slug;
	};
	if (!group) return mentionOnly(base);
	const candidates = group.map(([identity, v]) => ({ slug: identitySlug.get(identity), year: v.year ?? 0 }));
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

function appear(slug, e, role) {
	const f = slug && films.get(slug);
	if (f && !f.appearances.some((a) => a.id === e.id && a.role === role)) f.appearances.push({ id: e.id, role });
}

for (const e of all) {
	for (const r of e.reviews ?? []) {
		r.film = identitySlug.get(reviewIdentity.get(r)) ?? null;
		appear(r.film, e, 'review');
	}
	for (const w of e.watched ?? []) {
		w.film = resolveMention(w.title, w.year, e);
		appear(w.film, e, 'watched');
	}
	if (e.covers)
		e.covers = e.covers.map((c) => {
			const { title, year } = splitYear(c);
			const film = resolveMention(title, year, e);
			appear(film, e, 'premium');
			return { title: c, film };
		});
}

// Mention-only titles: show a year only when every mention agrees on it.
for (const f of films.values()) {
	if (f.years) {
		f.years.delete(null);
		f.years.delete(undefined);
		f.year = f.years.size === 1 ? [...f.years][0] : null;
		delete f.years;
	}
}
for (const [slug, f] of films) if (!f.appearances.length) films.delete(slug);

// ---------------------------------------------------------------- year in review

// Year-end shows (top 10 lists, the Junkies) usually air the following January.
const YEAR_END = /\b(top 10|top ten|best( and worst)?|worst) (movies|films) of (\d{4})\b|\b((?:19|20)\d\d) junkies\b|\bannual junkies\b|junkers' choice/i;
const yearEnd = {};
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

// ---------------------------------------------------------------- gumroad packs

// Each pack's cover shows the posters of the biggest (most-rated on TMDB) films reviewed in it.
const products = JSON.parse(read('gumroad.json'));
const packs = products
	.map((p) => {
		const range = p.name.match(/Episodes #?(\d+)-(\d+)/);
		const isBonus = !range && /movie review show|manifesto/i.test(p.name);
		if (!range && !isBonus) return null;
		const inPack = all.filter((e) =>
			range ? e.kind === 'regular' && e.number >= +range[1] && e.number <= +range[2] : e.pack === 'bonus'
		);
		const reviewed = [...new Set(inPack.flatMap((e) => (e.reviews ?? []).map((r) => r.film)).filter(Boolean))]
			.map((slug) => films.get(slug))
			.filter((f) => f?.poster)
			.sort((a, b) => b.votes - a.votes);
		return {
			label: p.name.match(/\((\d{4})\)/)?.[1] ?? (/space junk/i.test(p.name) ? 'Space Junk' : 'Bonus shows'),
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
	.filter(Boolean)
	.sort((a, b) => (b.from ?? -1) - (a.from ?? -1));

// ---------------------------------------------------------------- monthly schedule

// Transcribed from the calendars on Instagram. Each item is matched to its episode once it's out
// (retro episodes land on Patreon a week early).
const scheduleData = readJson('data/schedule.json') ?? {};
const schedule = Object.entries(scheduleData)
	.filter(([month]) => /^\d{4}-\d{2}$/.test(month))
	.map(([month, m]) => ({
		month,
		source: m.source ?? null,
		note: m.note ?? null,
		items: m.items.map((item) => {
			const key = titleKey(item.title);
			const episode = all.find(
				(e) =>
					(e.kind === 'regular' || e.kind === 'patreon') &&
					dayDiff(e.date, item.date) <= 14 &&
					(e.reviews ?? []).some((r) => titleKey(r.title) === key)
			);
			const review = episode?.reviews.find((r) => titleKey(r.title) === key);
			const film = review?.film ? films.get(review.film) : null;
			const tm = tmdbFor({ title: item.title, year: item.year }, { date: item.date });
			const free = episode && (episode.links.libsyn || episode.links.apple || episode.links.spotify);
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
const yearEndLists = readJson('data/year-end.json') ?? {};

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/episodes.json`, JSON.stringify(all, null, '\t'));
writeFileSync(`${OUT}/films.json`, JSON.stringify([...films.values()], null, '\t'));
writeFileSync(`${OUT}/meta.json`, JSON.stringify({ builtAt: new Date().toISOString(), yearNotes, gumroad, yearEnd, yearEndLists, packs, schedule }, null, '\t'));

const count = (k) => all.filter((e) => e.kind === k).length;
console.log(
	`episodes: ${count('regular')} regular, ${count('bonus')} bonus, ${count('premium')} premium; films: ${films.size} (${[...films.values()].filter((f) => f.appearances.some((a) => a.role !== 'watched')).length} reviewed, ${[...films.values()].filter((f) => f.tmdb).length} on TMDB)`
);
