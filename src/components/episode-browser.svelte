<script lang="ts">
	import { onMount } from 'svelte';
	import { closeOnBackdrop, fitFilterSheet } from '../lib/filter-sheet';

	export type Item = {
		id: string;
		n: number | null; // episode number
		k: 'regular' | 'bonus' | 'premium' | 'patreon';
		d: string; // ISO date
		t: string; // title
		h: string[]; // hosts who gave ratings
		a: number | null; // average rating out of 5, for sorting
		y?: true; // a year-end show: top 10 lists and the Junkies
		p?: string; // TMDB poster path of the first film reviewed
		r: { t?: string; s: [host: string, score: number, outOf: number][] }[]; // ratings per film reviewed
	};

	let { items, years, hosts }: { items: Item[]; years: string[]; hosts: string[] } = $props();

	const PAGE = 100;
	const KINDS = [
		['', 'All'],
		['regular', 'Weekly'],
		['premium', 'Premium'],
		['patreon', 'Patreon'],
		['bonus', 'Bonus'],
	] as const;

	let q = $state('');
	let year = $state('');
	let kind = $state('');
	let host = $state('');
	let junkies = $state(false);
	let sort = $state('newest');
	let shown = $state(PAGE);
	let sheet: HTMLDialogElement;
	// Filters in use, besides the search box: shown on the phone Filters button.
	let active = $derived([year, host, kind, junkies, sort !== 'newest'].filter(Boolean).length);

	onMount(() => fitFilterSheet(sheet));

	// Read filters from the URL once on load so filtered views can be shared.
	onMount(() => {
		const p = new URLSearchParams(location.search);
		q = p.get('q') ?? '';
		year = p.get('year') ?? '';
		kind = p.get('type') ?? '';
		host = p.get('host') ?? '';
		junkies = p.has('junkies');
		sort = p.get('sort') ?? 'newest';
	});

	function syncUrl() {
		const p = new URLSearchParams();
		if (q) p.set('q', q);
		if (year) p.set('year', year);
		if (kind) p.set('type', kind);
		if (host) p.set('host', host);
		if (junkies) p.set('junkies', '');
		if (sort !== 'newest') p.set('sort', sort);
		const qs = p.toString().replace(/=(?=&|$)/g, '');
		history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
		shown = PAGE;
	}

	let filtered = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		const numberQuery = /^\d+$/.test(needle) ? +needle : null;
		const list = items.filter(
			(e) =>
				(!year || e.d.startsWith(year)) &&
				(!kind || e.k === kind) &&
				(!host || e.h.includes(host)) &&
				(!junkies || e.y) &&
				(!needle || e.n === numberQuery || e.t.toLowerCase().includes(needle))
		);
		if (sort === 'oldest') return list.toReversed();
		if (sort === 'top') return list.filter((e) => e.a !== null).sort((a, b) => b.a! - a.a!);
		if (sort === 'bottom') return list.filter((e) => e.a !== null).sort((a, b) => a.a! - b.a!);
		return list;
	});

	const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
	// Full, half and empty stars on the host's scale, as in stars.astro; "6 out of 5" shows a sixth.
	const stars = (score: number, outOf: number) => {
		const full = Math.floor(Math.min(score, outOf)) + Math.max(0, Math.floor(score - outOf));
		const half = score % 1 >= 0.5 && score < outOf;
		return { full, half, empty: Math.max(0, outOf - Math.floor(Math.min(score, outOf)) - (half ? 1 : 0)) };
	};

	function reset() {
		q = year = kind = host = '';
		junkies = false;
		sort = 'newest';
		syncUrl();
	}
</script>

<div class="filters">
	<label class="grow">
		<span>Title or number</span>
		<input type="search" bind:value={q} oninput={syncUrl} placeholder="e.g. Dune or 500" />
	</label>
	<button type="button" class="button sheet-open" aria-haspopup="dialog" onclick={() => sheet.showModal()}>
		Filters{#if active}<span class="sheet-count" aria-label={`${active} on`}>{active}</span>{/if}
	</button>
	<dialog class="sheet" bind:this={sheet} onclick={closeOnBackdrop} aria-labelledby="episode-filters-h">
	<div class="sheet-head">
		<h2 id="episode-filters-h">Filters</h2>
		{#if active}<button type="button" class="link" onclick={reset}>Clear all</button>{/if}
	</div>
	<label>
		<span>Year</span>
		<select bind:value={year} onchange={syncUrl}>
			<option value="">Any year</option>
			{#each years as y}<option value={y}>{y}</option>{/each}
		</select>
	</label>
	<label>
		<span>Rated by</span>
		<select bind:value={host} onchange={syncUrl}>
			<option value="">Anyone</option>
			{#each hosts as h}<option value={h}>{h}</option>{/each}
		</select>
	</label>
	<label>
		<span>Sort</span>
		<select bind:value={sort} onchange={syncUrl}>
			<option value="newest">Newest first</option>
			<option value="oldest">Oldest first</option>
			<option value="top">Highest rated</option>
			<option value="bottom">Lowest rated</option>
		</select>
	</label>
	<fieldset>
		<legend>Type</legend>
		<div class="segmented">
			{#each KINDS as [value, label]}
				<label class:active={kind === value}>
					<input type="radio" name="kind" {value} bind:group={kind} onchange={syncUrl} />
					{label}
				</label>
			{/each}
		</div>
	</fieldset>
	<label class="toggle" class:active={junkies}>
		<input type="checkbox" bind:checked={junkies} onchange={syncUrl} />
		Junkies &amp; top 10s
	</label>
	<button type="button" class="button primary sheet-done" onclick={() => sheet.close()}>
		Show {filtered.length.toLocaleString()} episode{filtered.length === 1 ? '' : 's'}
	</button>
	</dialog>
</div>

<p class="count muted" aria-live="polite">
	{filtered.length.toLocaleString()} episode{filtered.length === 1 ? '' : 's'}
	{#if year}
		<a href={`/years/${year}/`}>{year} at a glance</a>
	{/if}
	{#if q || year || kind || host || junkies || sort !== 'newest'}
		<button type="button" class="link" onclick={reset}>Clear filters</button>
	{/if}
</p>

{#if filtered.length === 0}
	<p>Nothing matches those filters. Try a different year or clear the search.</p>
{:else}
	<ol class="list">
		{#each filtered.slice(0, shown) as e (e.id)}
			<li>
				<span class="sticker" data-kind={e.k}>{e.k === 'regular' && e.n ? e.n : { premium: 'Premium', patreon: 'Patreon', bonus: 'Bonus', regular: 'Episode' }[e.k]}</span>
				{#if e.p}
					<img class="poster" src={`https://image.tmdb.org/t/p/w92${e.p}`} alt="" width="92" height="138" loading="lazy" decoding="async" />
				{:else}
					<span class="poster"></span>
				{/if}
				<div>
					<a class="title" href={`/episodes/${e.id}/`}>{e.t}</a>
					<div class="meta">
						<time datetime={e.d}>{fmt.format(new Date(e.d + 'T00:00:00Z'))}</time>
					</div>
					{#each e.r as film}
						<div class="ratings">
							{#if film.t}<span class="film">{film.t}</span>{/if}
							{#each film.s as [h, score, outOf]}
								{@const st = stars(score, outOf)}
								<span class="rating">
									{h}
									<span class="stars" role="img" aria-label={`${score} out of ${outOf}`}
										><span class="on">{'★'.repeat(st.full)}</span>{#if st.half}<span class="half">★</span>{/if}<span class="off"
											>{'★'.repeat(st.empty)}</span
										></span
									>
								</span>
							{/each}
						</div>
					{/each}
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
		padding: 1rem 0;
		border-top: 1px solid var(--line);
	}

	.filters > label,
	.sheet > label:not(.toggle) {
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
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--ink);
		min-height: 2.5rem;
	}

	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
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
		border-radius: var(--radius);
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

	/* A quick filter, styled like one of the type options. */
	.toggle {
		display: block;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--bg);
		cursor: pointer;
		font-size: var(--step--1);
		font-weight: 600;
	}

	.toggle.active {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--bg);
	}

	.toggle:has(input:focus-visible) {
		outline: 3px solid var(--focus);
		outline-offset: 2px;
	}

	.toggle input,
	.segmented input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	@media (max-width: 40rem) {
		.filters {
			display: grid;
			grid-template-columns: 1fr auto;
			gap: 0.75rem;
			padding-block: 0.75rem;
		}

		.toggle {
			text-align: center;
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
		margin: 1.25rem 0 0.25rem;
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

	.list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.list li {
		display: grid;
		grid-template-columns: 5.5rem 2.75rem 1fr;
		gap: 1rem;
		align-items: start;
		padding-block: 0.75rem;
		border-bottom: 1px solid var(--line);
	}

	/* Decorative: the title next to it already names the film. A blank keeps titles aligned. */
	.poster {
		width: 100%;
		height: auto;
		aspect-ratio: 2 / 3;
		object-fit: cover;
		border-radius: var(--radius);
		background: var(--line);
	}

	span.poster {
		opacity: 0.4;
	}

	.list .sticker {
		justify-self: start;
		font-size: var(--step-1);
		font-weight: 800;
	}

	.title {
		font-weight: 700;
		text-decoration: none;
		color: var(--ink);
	}

	.title:hover {
		text-decoration: underline;
	}

	.meta {
		display: flex;
		gap: 1rem;
		font-size: var(--step--1);
		color: var(--muted);
	}

	.ratings {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 1rem;
		margin-top: 0.2rem;
		font-size: var(--step--1);
	}

	.film {
		color: var(--muted);
	}

	.rating {
		font-weight: 600;
		white-space: nowrap;
	}

	.stars {
		font-weight: 400;
		letter-spacing: 0.05em;
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

	@media (max-width: 30rem) {
		.list li {
			grid-template-columns: 4.25rem 2.25rem 1fr;
			gap: 0.6rem;
		}

		.list .sticker {
			font-size: var(--step-0);
		}
	}

	.more {
		margin-top: 1.5rem;
		cursor: pointer;
		font: inherit;
		font-weight: 600;
		color: inherit;
	}
</style>
