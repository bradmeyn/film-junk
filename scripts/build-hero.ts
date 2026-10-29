// Renders the home page's poster wall as one image (public/hero-wall*.webp), so the hero is a
// single request instead of 64 posters loading one by one. Runs after the data build; it only
// redraws when the set of posters changes (tracked in data/hero-wall.json).
// Usage: node scripts/build-hero.ts [--force]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import type { Film } from '../src/lib/types.ts';

const COUNT = 64;
const COLS = 16;
const TILE = { w: 150, h: 225, gap: 10 };
// Wide screens get the whole band; phones, where the hero is tall and narrow, a portrait crop from the middle.
const OUT = [
	{ file: 'public/hero-wall.webp', width: 2400, aspect: null },
	{ file: 'public/hero-wall-small.webp', width: 600, aspect: 0.7 },
];
const STATE = 'data/hero-wall.json';

// The same pick as the old in-page wall: reviewed films with posters, most discussed first.
const reviewCount = (f: Film) => f.appearances.filter((a) => a.role !== 'watched').length;
const films = (JSON.parse(readFileSync('src/data/films.json', 'utf8')) as Film[])
	.filter((f) => f.poster && reviewCount(f) > 0)
	.sort((a, b) => reviewCount(b) - reviewCount(a) || b.appearances.length - a.appearances.length)
	.slice(0, COUNT);
const posters = films.map((f) => f.poster!);

const previous = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, 'utf8')) as string[]) : [];
if (!process.argv.includes('--force') && OUT.every((o) => existsSync(o.file)) && previous.join() === posters.join()) {
	console.log('hero wall: unchanged');
	process.exit(0);
}

async function tile(path: string) {
	const res = await fetch(`https://image.tmdb.org/t/p/w185${path}`);
	if (!res.ok) throw new Error(`${res.status} poster ${path}`);
	return sharp(Buffer.from(await res.arrayBuffer())).resize(TILE.w, TILE.h, { fit: 'cover' }).toBuffer();
}

// Lay the posters out in a grid, tilt it, then crop the middle so no corner shows a gap.
const rows = Math.ceil(posters.length / COLS);
const width = COLS * (TILE.w + TILE.gap);
const height = rows * (TILE.h + TILE.gap);
const tiles = await Promise.all(posters.map(tile));
const grid = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
	.composite(tiles.map((input, i) => ({ input, left: (i % COLS) * (TILE.w + TILE.gap), top: Math.floor(i / COLS) * (TILE.h + TILE.gap) })))
	.png()
	.toBuffer();
const tilted = await sharp(grid).rotate(-5, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
const meta = await sharp(tilted).metadata();
const crop = { width: Math.round(width * 0.9), height: Math.round(height * 0.78) };
const cropped = await sharp(tilted)
	.extract({ left: Math.round((meta.width! - crop.width) / 2), top: Math.round((meta.height! - crop.height) / 2), ...crop })
	.png()
	.toBuffer();

for (const { file, width: w, aspect } of OUT) {
	let image = sharp(cropped);
	if (aspect) {
		const cw = Math.round(crop.height * aspect);
		image = sharp(await image.extract({ left: Math.round((crop.width - cw) / 2), top: 0, width: cw, height: crop.height }).png().toBuffer());
	}
	await image.resize({ width: w }).webp({ quality: 62, alphaQuality: 80 }).toFile(file);
	console.log(`hero wall: wrote ${file}`);
}
writeFileSync(STATE, JSON.stringify(posters, null, '\t') + '\n');
