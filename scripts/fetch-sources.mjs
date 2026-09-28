// Downloads raw source data into data/raw. Past years are cached; the current
// year's guide, RSS feed and Bandcamp catalogue are always refetched.
// Usage: node scripts/fetch-sources.mjs [--all]
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const RAW = 'data/raw';
const refetchAll = process.argv.includes('--all');
const currentYear = new Date().getFullYear();

const SPOTIFY_SHOW_ID = '7gC4H6NxbAnQLB7ahS5u2P';
const WIKI_PAGES = ['2005', '2006 (SJ)', 'Episodes', ...range(2007, 2020).map(String), 'Premiums'];

function range(a, b) {
	return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

async function get(url) {
	const res = await fetch(url, { headers: { 'user-agent': 'film-junk-guide (fan site)' } });
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.text();
}

async function save(path, url, { force = false } = {}) {
	const file = join(RAW, path);
	if (!force && !refetchAll && (await exists(file))) return false;
	await writeFile(file, await get(url));
	await sleep(300);
	return true;
}

function guideUrl(year) {
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
await fetchSpotify();
await fetchPatreonFeed();
await save('gumroad.html', 'https://filmjunk.gumroad.com/', { force: true });
await fetchGumroadProducts();
await save('bandcamp/index.html', 'https://filmjunk.bandcamp.com/music', { force: true });

// Bandcamp: the index lists a few albums as links and the rest in a JSON attribute.
const index = await import('node:fs/promises').then((fs) => fs.readFile(join(RAW, 'bandcamp/index.html'), 'utf8'));
const albums = new Set([...index.matchAll(/href="(\/album\/[^"?]+)"/g)].map((m) => m[1]));
const clientItems = index.match(/data-client-items="([^"]*)"/);
if (clientItems) {
	for (const item of JSON.parse(decodeEntities(clientItems[1]))) albums.add(item.page_url);
}
for (const path of albums) {
	const slug = path.split('/').pop();
	if (await save(`bandcamp/${slug}.html`, `https://filmjunk.bandcamp.com${path}`)) console.log('bandcamp', slug);
}

// The profile page only embeds the first 9 products; the rest load from a paged search.
async function fetchGumroadProducts() {
	const html = await import('node:fs/promises').then((fs) => fs.readFile(join(RAW, 'gumroad.html'), 'utf8'));
	const page = JSON.parse(decodeEntities(html.match(/data-page="([^"]*)"/)[1]));
	const sellerId = page.props.creator_profile.external_id;
	const section = page.props.sections.find((s) => s.type === 'SellerProfileProductsSection');
	const products = [...section.search_results.products];
	while (products.length < section.search_results.total) {
		const url = `https://filmjunk.gumroad.com/products/search?user_id=${sellerId}&section_id=${encodeURIComponent(section.id)}&from=${products.length}&sort=newest`;
		const { products: more } = JSON.parse(await get(url));
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

// A patron's private Patreon RSS feed (PATREON_RSS_URL). The URL and the audio links carry a
// personal token, so only public metadata is kept: title, date, public post URL, duration.
async function fetchPatreonFeed() {
	const url = process.env.PATREON_RSS_URL;
	if (!url) {
		console.log('patreon: skipped (no PATREON_RSS_URL)');
		return;
	}
	const res = await fetch(url, { headers: { 'user-agent': 'film-junk-guide (fan site)' } });
	if (!res.ok) throw new Error(`patreon feed: ${res.status}`); // never log the URL
	const xml = await res.text();
	const tag = (item, name) =>
		(item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
	const posts = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => ({
		title: decodeEntities(tag(item, 'title')).replace(/\s+/g, ' '),
		date: new Date(tag(item, 'pubDate')).toISOString().slice(0, 10),
		url: tag(item, 'link').split('?')[0],
		duration: +tag(item, 'itunes:duration') || null,
	}));
	await writeFile(join(RAW, 'patreon-feed.json'), JSON.stringify(posts, null, '\t'));
	console.log(`patreon: ${posts.length} posts`);
}

// Needs a free Spotify developer app: set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (e.g. in .env).
async function fetchSpotify() {
	const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env;
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
	if (!tokenRes.ok) throw new Error(`spotify token: ${tokenRes.status}`);
	const { access_token } = await tokenRes.json();

	const episodes = [];
	let url = `https://api.spotify.com/v1/shows/${SPOTIFY_SHOW_ID}/episodes?market=US&limit=50`;
	while (url) {
		const res = await fetch(url, { headers: { authorization: `Bearer ${access_token}` } });
		if (!res.ok) throw new Error(`spotify episodes: ${res.status}`);
		const page = await res.json();
		for (const e of page.items.filter(Boolean))
			episodes.push({ title: e.name, date: e.release_date, url: e.external_urls.spotify });
		url = page.next;
		await sleep(200);
	}
	await writeFile(join(RAW, 'spotify.json'), JSON.stringify(episodes, null, '\t'));
	console.log(`spotify: ${episodes.length} episodes`);
}

function decodeEntities(s) {
	return s
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

console.log('done');
