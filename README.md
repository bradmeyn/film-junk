# Film Junk Podcast (fan guide)

An unofficial, searchable guide to every Film Junk Podcast episode, premium and bonus show.
Static Astro site with Svelte islands for search and filters.

## Data

```sh
npm run data        # fetch sources into data/raw, then parse into src/data/*.json
```

Sources, in order of priority:

- **Official libsyn episode guides** (2006 on): reviews, host star ratings, "other stuff we watched", segments, music
- **Film Junk fan wiki** (fandom, CC BY-SA): Space Junk-era episodes (2005–06), notes per episode, yearly highlights
- **Podcast RSS**: episodes newer than the latest guide (numbers taken from the mp3 filename)
- **Bandcamp**: premium episodes, art, descriptions; matched to the wiki's premium list for numbers and films
- **Gumroad**: yearly archive bundles, linked by episode number range

- **Apple Podcasts** (public lookup API): per-episode links for episodes still in the feed
- **Spotify** (Web API, optional): per-episode links. Create an app at developer.spotify.com and put
  `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` in `.env` (see `.env.example`) and in the repo secrets
- **Patreon**: set `PATREON_RSS_URL` (a patron's private feed URL) in `.env` and repo secrets. It's a personal
  credential, so posts are reduced to title, date, public post link, duration and description text with every
  link removed, then merged into the committed `data/patreon.json` (builds never need the feed itself). Weekly
  episodes and premiums get a Patreon link; everything else becomes a "Patreon exclusive" entry linking to the
  locked post. Films named in descriptions (timestamped chapters, "Title (1985)", reviewed titles) are indexed.
  `scripts/patreon-export.js` is a manual fallback

- **TMDB** (optional): posters, the right year, and IMDb/Letterboxd links for each film. Mentioned-only films
  use exact title matches only (the most-rated when several share a title). Put `TMDB_API_KEY` (either the API key or
  the read access token) in `.env` and repo secrets. Matches are cached in `data/tmdb.json`, so only new films are
  looked up; `node scripts/fetch-tmdb.mjs --retry` re-tries ones that found nothing. Fix bad matches in
  `data/tmdb-overrides.json`

- **Monthly schedule** (manual): `data/schedule.json`, transcribed from the calendar image Film Junk posts on
  Instagram each month (Instagram needs a login, so it can't be fetched). Add the new month's four-ish items; the
  build matches each to its episode once it's out and shows it as out, on Patreon early, or coming up

Reviewed films are identified by their TMDB id, so remakes get separate pages (`/films/dune/`, `/films/dune-1984/`).
Mentions in "what we watched" only have a title, so they're attached to the reviewed film with the same title that
fits the date best, or get their own page when the year says it's a different film.

## Develop

```sh
npm install
npm run dev
npm run build       # ~9k static pages into dist/
```

## Deploy

`.github/workflows/deploy.yml` refreshes the data daily and commits it. Cloudflare Workers, connected to this repo,
builds and deploys every push to `main` (`wrangler.jsonc` serves `dist/`).

- GitHub repo secrets (Settings > Secrets and variables > Actions): `TMDB_API_KEY` and `PATREON_RSS_URL`, plus
  optionally `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`.
- The site's public address (`https://filmjunkpodcast.com`) is set as `site` in `astro.config.mjs`.
