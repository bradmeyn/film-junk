// Downloads raw source data into data/raw. Past years are cached; the current
// year's guide, RSS feed and Bandcamp catalogue are always refetched.
// Usage: node scripts/fetch-sources.mjs [--all]
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const RAW = 'data/raw';
const PATREON = 'data/patreon.json'; // committed, sanitised Patreon posts
const refetchAll = process.argv.includes('--all');
const currentYear = new Date().getFullYear();

const SPOTIFY_SHOW_ID = '7gC4H6NxbAnQLB7ahS5u2P';
const WIKI_PAGES = ['2005', '2006 (SJ)', 'Episodes', ...range(2007, 2020).map(String), 'Premiums'];

function range(a: number, b: number): number[] {
	return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exists = (p: string) => access(p).then(() => true, () => false);

async function get(url: string): Promise<string> {
	const res = await fetch(url, { headers: { 'user-agent': 'film-junk-guide (fan site)' } });
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.text();
}

async function save(path: string, url: string, { force = false } = {}): Promise<boolean> {
	const file = join(RAW, path);
	if (!force && !refetchAll && (await exists(file))) return false;
	await writeFile(file, await get(url));
	await sleep(300);
	return true;
}

function guideUrl(year: number): string {
	return year >= 2024
		? `https://filmjunk.libsyn.com/${year}-episodes`
		: `https://filmjunk.libsyn.com/film-junk-podcast-${year}-episode-guide`;
}

await Promise.all(['guides', 'wiki', 'bandcamp'].map((d) => mkdir(join(RAW, d), { recursive: true })));

for (const year of range(2005, currentYear)) {
	if (await save(`guides/${year}.html`, guideUrl(year), { force: year === currentYear }))
		console.log('guide', year);
}

for (const page of WIKI_PAGES) {
	const url = `https://filmjunk.fandom.com/api.php?action=parse&prop=wikitext&format=json&page=${encodeURIComponent(page)}`;
	if (await save(`wiki/${page}.json`, url)) console.log('wiki', page);
}

await save('libsyn.xml', 'https://filmjunk.libsyn.com/rss', { force: true });
await save('feedburner.xml', 'https://feeds.feedburner.com/filmjunk', { force: true });
// Apple only returns episodes still in the feed (up to 200).
await save('apple.json', 'https://itunes.apple.com/lookup?id=74257105&entity=podcastEpisode&limit=200', { force: true });
// Spotify links are a nice-to-have: if it fails, keep the last fetched data rather than stopping the refresh.
await fetchSpotify().catch((err: unknown) => console.warn(`spotify: failed, keeping previous data (${err instanceof Error ? err.message : err})`));
await fetchPatreonFeed();
await save('gumroad.html', 'https://filmjunk.gumroad.com/', { force: true });
await fetchGumroadProducts();
await save('bandcamp/index.html', 'https://filmjunk.bandcamp.com/music', { force: true });

// Bandcamp: the index lists a few albums as links and the rest in a JSON attribute.
const index = await readFile(join(RAW, 'bandcamp/index.html'), 'utf8');
const albums = new Set([...index.matchAll(/href="(\/album\/[^"?]+)"/g)].map((m) => m[1]));
const clientItems = index.match(/data-client-items="([^"]*)"/);
if (clientItems) {
	for (const item of JSON.parse(decodeEntities(clientItems[1])) as { page_url: string }[]) albums.add(item.page_url);
}
for (const path of albums) {
	const slug = path.split('/').pop();
	if (await save(`bandcamp/${slug}.html`, `https://filmjunk.bandcamp.com${path}`)) console.log('bandcamp', slug);
}

// Just the fields we use from Gumroad's profile page data.
type GumroadProduct = { name: string; url: string; price_cents: number; currency_code: string };
type GumroadSection = { id: string; type: string; search_results: { total: number; products: GumroadProduct[] } };

// The profile page only embeds the first 9 products; the rest load from a paged search.
async function fetchGumroadProducts() {
	const html = await readFile(join(RAW, 'gumroad.html'), 'utf8');
	const data = html.match(/data-page="([^"]*)"/);
	if (!data) throw new Error('gumroad: profile data not found');
	const page = JSON.parse(decodeEntities(data[1]));
	const sellerId: string = page.props.creator_profile.external_id;
	const section = (page.props.sections as GumroadSection[]).find((s) => s.type === 'SellerProfileProductsSection');
	if (!section) throw new Error('gumroad: products section not found');
	const products = [...section.search_results.products];
	while (products.length < section.search_results.total) {
		const url = `https://filmjunk.gumroad.com/products/search?user_id=${sellerId}&section_id=${encodeURIComponent(section.id)}&from=${products.length}&sort=newest`;
		const { products: more } = JSON.parse(await get(url)) as { products: GumroadProduct[] };
		if (!more.length) break;
		products.push(...more);
		await sleep(300);
	}
	// Pages can overlap by one product.
	const unique = [...new Map(products.map((p) => [p.url.split('?')[0], p])).values()];
	const slim = unique.map((p) => ({ name: p.name.trim(), url: p.url.split('?')[0], price: p.price_cents / 100, currency: p.currency_code }));
	await writeFile(join(RAW, 'gumroad.json'), JSON.stringify(slim, null, '\t'));
	console.log(`gumroad: ${slim.length} products`);
}

// A patron's private Patreon RSS feed (PATREON_RSS_URL). The feed URL and its audio links carry a
// personal token, so nothing that lets someone listen is kept: posts are reduced to title, date,
// public post URL, duration and description text with every link removed. The result is committed
// (data/patreon.json) so builds and CI don't need the feed; each fetch merges new posts in.
type PatreonPost = { title: string; date: string; url: string; duration: number | null; description: string };

function sanitizeDescription(html: string): string {
	// The feed entity-encodes its HTML, so decode before stripping tags (then decode the text).
	const text = decodeEntities(
		decodeEntities(html)
			.replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
			.replace(/<[^>]+>/g, '')
	)
		// No links of any kind: media, tokens, or otherwise.
		.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
		.replace(/[ \t ]+/g, ' ')
		.replace(/\n\s*\n+/g, '\n\n')
		.trim();
	if (/auth=|token=|\.mp3|patreonusercontent/i.test(text)) throw new Error('patreon: description still contains a media link');
	return text;
}

async function fetchPatreonFeed() {
	const url = process.env.PATREON_RSS_URL;
	if (!url) {
		console.log('patreon: skipped (no PATREON_RSS_URL); using the committed data/patreon.json');
		return;
	}
	const res = await fetch(url, { headers: { 'user-agent': 'film-junk-guide (fan site)' } });
	if (!res.ok) throw new Error(`patreon feed: ${res.status}`); // never log the URL
	const xml = await res.text();
	const tag = (item: string, name: string) =>
		(item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
	const fresh: PatreonPost[] = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => ({
		title: decodeEntities(tag(item, 'title')).replace(/\s+/g, ' '),
		date: new Date(tag(item, 'pubDate')).toISOString().slice(0, 10),
		url: tag(item, 'link').split('?')[0],
		duration: +tag(item, 'itunes:duration') || null,
		description: sanitizeDescription(tag(item, 'description')),
	}));
	const existing: PatreonPost[] = (await exists(PATREON)) ? JSON.parse(await readFile(PATREON, 'utf8')) : [];
	const byUrl = new Map(existing.map((p) => [p.url, p]));
	for (const p of fresh) byUrl.set(p.url, p);
	const posts = [...byUrl.values()].sort((a, b) => b.date.localeCompare(a.date));
	await writeFile(PATREON, JSON.stringify(posts, null, '\t') + '\n');
	console.log(`patreon: ${fresh.length} in feed, ${posts.length} saved`);
}

// Needs a free Spotify developer app: set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (e.g. in .env).
async function fetchSpotify() {
	// Trimmed: a pasted secret often carries a trailing newline or space.
	const id = process.env.SPOTIFY_CLIENT_ID?.trim();
	const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
	if (!id || !secret) {
		console.log('spotify: skipped (no SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET)');
		return;
	}
	const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
			'content-type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	});
	// Spotify's error body is just a code like {"error":"invalid_client"}, safe to log.
	if (!tokenRes.ok) throw new Error(`spotify token: ${tokenRes.status} ${await tokenRes.text()}`);
	const { access_token } = (await tokenRes.json()) as { access_token: string };

	const episodes: { title: string; date: string; url: string }[] = [];
	let url: string | null = `https://api.spotify.com/v1/shows/${SPOTIFY_SHOW_ID}/episodes?market=US&limit=50`;
	while (url) {
		const res = await fetch(url, { headers: { authorization: `Bearer ${access_token}` } });
		if (!res.ok) throw new Error(`spotify episodes: ${res.status}`);
		const page = (await res.json()) as {
			items: ({ name: string; release_date: string; external_urls: { spotify: string } } | null)[];
			next: string | null;
		};
		for (const e of page.items.filter((x) => x !== null))
			episodes.push({ title: e.name, date: e.release_date, url: e.external_urls.spotify });
		url = page.next;
		await sleep(200);
	}
	await writeFile(join(RAW, 'spotify.json'), JSON.stringify(episodes, null, '\t'));
	console.log(`spotify: ${episodes.length} episodes`);
}

function decodeEntities(s: string): string {
	return s
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

console.log('done');
