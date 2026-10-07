<script lang="ts">
	import { onMount } from 'svelte';

	// One review of one film. Scores are normalised to 5 stars; "6 out of 5" stays above 5.
	export type Item = {
		k: string; // unique key: episode id + film
		f: string | null; // film slug
		t: string; // title
		y: number | null; // release year
		p: string | null; // TMDB poster path
		e: string; // episode href
		l: string; // episode label and date
		d: string; // ISO date of the episode
		r: { h: string; s: number; o: number }[]; // ratings: host, score, out of
		a: number | null; // average out of 5, with 6/5 counted as 5
	};

	let { items, hosts }: { items: Item[]; hosts: string[] } = $props();

	const PAGE = 60;
	// Bands of the average (or the chosen host's score), out of 5.
	const RATINGS = [
		['', 'Any'],
		['6', '6 out of 5'],
		['4.5', '4½ and up'],
		['3.5', '3½–4'],
		['2.5', '2½–3'],
		['0', '2 and under'],
	] as const;
	const SORTS = [
		['top', 'Highest rated'],
		['bottom', 'Lowest rated'],
		['newest', 'Newest review'],
		['oldest', 'Oldest review'],
		['released-new', 'Release year, newest'],
		['released-old', 'Release year, oldest'],
		['title', 'Title A–Z'],
	] as const;
	const DEFAULTS = { q: '', rating: '', host: '', decade: '', reviewed: '', sort: 'top' };

	let q = $state('');
	let rating = $state('');
	let host = $state('');
	let decade = $state('');
	let reviewed = $state('');
	let sort = $state('top');
	let shown = $state(PAGE);

	const decades = [...new Set(items.flatMap((i) => (i.y ? [Math.floor(i.y / 10) * 10] : [])))].sort((a, b) => b - a);
	const reviewYears = [...new Set(items.map((i) => i.d.slice(0, 4)))].sort().reverse();

	// Read filters from the URL once on load so filtered views can be shared.
	onMount(() => {
		const p = new URLSearchParams(location.search);
		q = p.get('q') ?? '';
		rating = p.get('rating') ?? '';
		host = p.get('host') ?? '';
		decade = p.get('decade') ?? '';
		reviewed = p.get('reviewed') ?? '';
		sort = p.get('sort') ?? DEFAULTS.sort;
	});

	function syncUrl() {
		const values = { q, rating, host, decade, reviewed, sort };
		const p = new URLSearchParams();
		for (const [name, value] of Object.entries(values)) if (value !== DEFAULTS[name as keyof typeof DEFAULTS]) p.set(name, value);
		const qs = p.toString();
		history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
		shown = PAGE;
	}

	const toFive = (r: { s: number; o: number }) => (r.s / r.o) * 5;
	// The score the filters and sorting use: the chosen host's, else the average.
	const scoreOf = (i: Item) => {
		if (!host) return i.a;
		const r = i.r.find((x) => x.h === host);
		return r ? Math.min(5, toFive(r)) : null;
	};

	function inBand(i: Item) {
		if (!rating) return true;
		if (rating === '6') return i.r.some((r) => (!host || r.h === host) && toFive(r) > 5);
		const s = scoreOf(i);
		if (s === null) return false;
		if (rating === '4.5') return s >= 4.5;
		if (rating === '3.5') return s >= 3.5 && s < 4.5;
		if (rating === '2.5') return s >= 2.5 && s < 3.5;
		return s < 2.5;
	}

	const normalize = (s: string) =>
		s
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase();

	let filtered = $derived.by(() => {
		const needle = normalize(q.trim());
		const list = items.filter(
			(i) =>
				(!host || i.r.some((r) => r.h === host)) &&
				(!decade || (i.y !== null && Math.floor(i.y / 10) * 10 === +decade)) &&
				(!reviewed || i.d.startsWith(reviewed)) &&
				(!needle || normalize(i.t).includes(needle)) &&
				inBand(i)
		);
		const byDate = (a: Item, b: Item) => b.d.localeCompare(a.d);
		const rated = (a: Item, b: Item, dir: number) => {
			const x = scoreOf(a);
			const y = scoreOf(b);
			if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
			return dir * (y - x);
		};
		const year = (a: Item, b: Item, dir: number) => {
			if (a.y === null || b.y === null) return a.y === null ? (b.y === null ? 0 : 1) : -1;
			return dir * (b.y - a.y);
		};
		switch (sort) {
			case 'bottom':
				return list.sort((a, b) => rated(a, b, -1) || byDate(a, b));
			case 'newest':
				return list.sort(byDate);
			case 'oldest':
				return list.sort((a, b) => byDate(b, a));
			case 'released-new':
				return list.sort((a, b) => year(a, b, 1) || byDate(a, b));
			case 'released-old':
				return list.sort((a, b) => year(a, b, -1) || byDate(a, b));
			case 'title':
				return list.sort((a, b) => a.t.localeCompare(b.t));
			default:
				return list.sort((a, b) => rated(a, b, 1) || byDate(a, b));
		}
	});

	let changed = $derived(q || rating || host || decade || reviewed || sort !== DEFAULTS.sort);

	function reset() {
		q = rating = host = decade = reviewed = '';
		sort = DEFAULTS.sort;
		syncUrl();
	}

	// Stars as on the rest of the site: full, half, then empty; 6 out of 5 shows a sixth star.
	function stars(r: { s: number; o: number }) {
		const full = Math.floor(Math.min(r.s, r.o));
		const half = r.s % 1 >= 0.5 && r.s < r.o;
		return { on: '★'.repeat(full + Math.max(0, Math.floor(r.s - r.o))), half, off: '★'.repeat(Math.max(0, r.o - full - (half ? 1 : 0))) };
	}
</script>

<div class="filters">
	<label class="grow">
		<span>Title</span>
		<input type="search" bind:value={q} oninput={syncUrl} placeholder="e.g. Alien" />
	</label>
	<label>
		<span>Rated by</span>
		<select bind:value={host} onchange={syncUrl}>
			<option value="">Anyone</option>
			{#each hosts as h}<option value={h}>{h}</option>{/each}
		</select>
	</label>
	<label>
		<span>Released</span>
		<select bind:value={decade} onchange={syncUrl}>
			<option value="">Any decade</option>
			{#each decades as d}<option value={String(d)}>{d}s</option>{/each}
		</select>
	</label>
	<label>
		<span>Reviewed in</span>
		<select bind:value={reviewed} onchange={syncUrl}>
			<option value="">Any year</option>
			{#each reviewYears as y}<option value={y}>{y}</option>{/each}
		</select>
	</label>
	<label>
		<span>Sort</span>
		<select bind:value={sort} onchange={syncUrl}>
			{#each SORTS as [value, label]}<option {value}>{label}</option>{/each}
		</select>
	</label>
	<fieldset>
		<legend>{host ? `${host}'s rating` : 'Average rating'}</legend>
		<div class="segmented">
			{#each RATINGS as [value, label]}
				<label class:active={rating === value}>
					<input type="radio" name="rating" {value} bind:group={rating} onchange={syncUrl} />
					{label}
				</label>
			{/each}
		</div>
	</fieldset>
</div>

<p class="count muted" aria-live="polite">
	{filtered.length.toLocaleString()} review{filtered.length === 1 ? '' : 's'}
	{#if changed}
		<button type="button" class="link" onclick={reset}>Clear filters</button>
	{/if}
</p>

{#if filtered.length === 0}
	<p>Nothing matches those filters. Try another rating band or decade.</p>
{:else}
	<ol class="grid">
		{#each filtered.slice(0, shown) as i (i.k)}
			<li>
				<div class="poster">
					{#if i.p}<img src={`https://image.tmdb.org/t/p/w154${i.p}`} alt="" width="154" height="231" loading="lazy" />{:else}<span aria-hidden="true">{i.t.slice(0, 1)}</span>{/if}
				</div>
				<div class="body">
					<h3>
						{#if i.f}<a href={`/films/${i.f}/`}>{i.t}</a>{:else}{i.t}{/if}
						{#if i.y}<span class="muted"> ({i.y})</span>{/if}
					</h3>
					<a class="ep muted" href={i.e}>{i.l}</a>
					{#if i.r.length}
						<ul class="ratings">
							{#each i.r as r}
								{@const s = stars(r)}
								<li class:picked={r.h === host}>
									<span>{r.h}</span>
									<span class="stars" role="img" aria-label={`${r.h}: ${r.s} out of ${r.o}`}
										><span class="on">{s.on}</span>{#if s.half}<span class="half">★</span>{/if}<span class="off">{s.off}</span></span
									>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="muted unrated">No ratings</p>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
	{#if filtered.length > shown}
		<button type="button" class="button more" onclick={() => (shown += PAGE)}>
			Show {Math.min(PAGE, filtered.length - shown)} more
		</button>
	{/if}
{/if}

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
		align-items: end;
		padding: 1rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 0.6rem;
	}

	.filters > label {
		display: grid;
		gap: 0.25rem;
	}

	.grow {
		flex: 1 1 14rem;
	}

	.filters label > span,
	legend {
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--muted);
	}

	input[type='search'] {
		font: inherit;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		background: var(--bg);
		color: var(--ink);
		min-height: 2.5rem;
	}

	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}

	legend {
		padding: 0;
		margin-bottom: 0.25rem;
	}

	/* The 1px gap over the line colour draws dividers however the options wrap. */
	.segmented {
		display: flex;
		flex-wrap: wrap;
		gap: 1px;
		background: var(--line);
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		overflow: hidden;
	}

	.segmented label {
		padding: 0.5rem 0.75rem;
		cursor: pointer;
		font-size: var(--step--1);
		font-weight: 600;
		background: var(--bg);
	}

	.segmented label.active {
		background: var(--ink);
		color: var(--bg);
	}

	.segmented label:has(input:focus-visible) {
		outline: 3px solid var(--focus);
		outline-offset: -3px;
	}

	.segmented input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	@media (max-width: 40rem) {
		.filters {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 0.75rem;
			padding: 0.75rem;
		}

		.filters .grow,
		.filters fieldset {
			grid-column: 1 / -1;
		}

		.filters select {
			width: 100%;
		}

		.segmented label {
			flex: 1 1 auto;
			text-align: center;
			padding-inline: 0.5rem;
		}
	}

	.count {
		display: flex;
		gap: 1rem;
		align-items: baseline;
		margin: 1.25rem 0 0.75rem;
	}

	.link {
		font: inherit;
		background: none;
		border: 0;
		padding: 0;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
	}

	.grid {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
		gap: 0.75rem;
	}

	.grid > li {
		display: grid;
		grid-template-columns: 5.5rem 1fr;
		gap: 0.9rem;
		padding: 0.75rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 0.6rem;
	}

	.poster {
		aspect-ratio: 2 / 3;
		border-radius: 0.3rem;
		overflow: hidden;
		background: var(--line);
		display: grid;
		place-items: center;
		font-size: 2rem;
		font-weight: 800;
		color: var(--muted);
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.body {
		min-width: 0;
	}

	h3 {
		font-size: var(--step-0);
		margin: 0;
		line-height: 1.3;
	}

	h3 a {
		text-decoration: none;
	}

	h3 a:hover {
		text-decoration: underline;
	}

	.ep {
		display: block;
		margin-top: 0.15rem;
		font-size: var(--step--1);
	}

	.unrated {
		margin: 0.5rem 0 0;
		font-size: var(--step--1);
	}

	.ratings {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: grid;
		gap: 0.1rem;
		font-size: var(--step--1);
	}

	.ratings li {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.1rem 0.35rem;
		border-radius: 0.25rem;
	}

	.ratings li.picked {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		font-weight: 700;
	}

	.stars {
		letter-spacing: 0.05em;
		white-space: nowrap;
	}

	.on {
		color: var(--star);
	}

	.off {
		color: var(--line);
	}

	.half {
		background: linear-gradient(90deg, var(--star) 50%, var(--line) 50%);
		background-clip: text;
		-webkit-background-clip: text;
		color: transparent;
	}

	.more {
		margin-top: 1.5rem;
		cursor: pointer;
		font: inherit;
		font-weight: 600;
		color: inherit;
	}
</style>
