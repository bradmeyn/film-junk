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
  credential: only each post's title, date, public post link and duration are kept (never descriptions or audio
  links). Weekly episodes and premiums get a Patreon link; everything else becomes a "Patreon exclusive" entry
  that links to the locked post. Without the feed, `scripts/patreon-export.js` is a manual fallback

- **TMDB** (optional): posters and the right year for each reviewed film. Put `TMDB_API_KEY` (either the API key or
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
npm run build       # ~8k static pages into dist/
```

## Deploy

`.github/workflows/deploy.yml` refreshes the data daily, commits it, builds and deploys to Cloudflare Pages.
Set the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets and create a Pages project named `film-junk`.
