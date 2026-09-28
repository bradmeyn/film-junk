<script lang="ts">
	import { onMount } from 'svelte';

	export type Item = {
		id: string;
		n: number | null; // episode number
		k: 'regular' | 'bonus' | 'premium' | 'patreon';
		d: string; // ISO date
		t: string; // title
		h: string[]; // hosts who gave ratings
		a: number | null; // average rating out of 5
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
	let sort = $state('newest');
	let shown = $state(PAGE);

	// Read filters from the URL once on load so filtered views can be shared.
	onMount(() => {
		const p = new URLSearchParams(location.search);
		q = p.get('q') ?? '';
		year = p.get('year') ?? '';
		kind = p.get('type') ?? '';
		host = p.get('host') ?? '';
		sort = p.get('sort') ?? 'newest';
	});

	function syncUrl() {
		const p = new URLSearchParams();
		if (q) p.set('q', q);
		if (year) p.set('year', year);
		if (kind) p.set('type', kind);
		if (host) p.set('host', host);
		if (sort !== 'newest') p.set('sort', sort);
		const qs = p.toString();
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
				(!needle || e.n === numberQuery || e.t.toLowerCase().includes(needle))
		);
		if (sort === 'oldest') return list.toReversed();
		if (sort === 'top') return list.filter((e) => e.a !== null).sort((a, b) => b.a! - a.a!);
		if (sort === 'bottom') return list.filter((e) => e.a !== null).sort((a, b) => a.a! - b.a!);
		return list;
	});

	const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
	const stars = (a: number) => '★'.repeat(Math.floor(a)) + (a % 1 ? '½' : '');

	function reset() {
		q = year = kind = host = '';
		sort = 'newest';
		syncUrl();
	}
</script>

<div class="filters">
	<label class="grow">
		<span>Title or number</span>
		<input type="search" bind:value={q} oninput={syncUrl} placeholder="e.g. Dune or 500" />
	</label>
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
</div>

<p class="count muted" aria-live="polite">
	{filtered.length.toLocaleString()} episode{filtered.length === 1 ? '' : 's'}
	{#if q || year || kind || host || sort !== 'newest'}
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
				<div>
					<a class="title" href={`/episodes/${e.id}/`}>{e.t}</a>
					<div class="meta">
						<time datetime={e.d}>{fmt.format(new Date(e.d + 'T00:00:00Z'))}</time>
						{#if e.a !== null}<span class="stars" aria-label={`Average rating ${e.a} out of 5`}>{stars(e.a)}</span>{/if}
					</div>
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

	input[type='search'],
	select {
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
	}

	legend {
		padding: 0;
		margin-bottom: 0.25rem;
	}

	.segmented {
		display: flex;
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

	.segmented label + label {
		border-left: 1px solid var(--line);
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
		grid-template-columns: 5.5rem 1fr;
		gap: 1rem;
		align-items: start;
		padding-block: 0.75rem;
		border-bottom: 1px solid var(--line);
	}

	.list .sticker {
		justify-self: start;
		color: var(--brand-ink);
		font-size: var(--step-1);
		font-weight: 800;
	}

	.list .sticker[data-kind='bonus'] {
		color: var(--bg);
	}

	.list .sticker[data-kind='patreon'] {
		color: var(--accent);
	}

	.title {
		font-weight: 700;
		text-decoration: none;
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

	.stars {
		color: var(--star);
		font-weight: 400;
		font-size: inherit;
		letter-spacing: 0.05em;
	}

	.more {
		margin-top: 1.5rem;
		cursor: pointer;
		font: inherit;
		font-weight: 600;
		color: inherit;
	}
</style>
