<script lang="ts">
	import { onMount } from 'svelte';

	type Row = [slug: string, title: string, year: number, reviews: number, mentions: number];

	// compact: the header search, with results in a dropdown. Otherwise results render inline.
	let { compact = false, limit = 8, id = 'film-search' }: { compact?: boolean; limit?: number; id?: string } = $props();

	let query = $state('');
	let open = $state(false);
	let index = $state<Row[] | null>(null);
	let keys: string[] = [];
	let loading: Promise<void> | null = null;
	let root: HTMLElement;
	let input: HTMLInputElement;

	const normalize = (s: string) =>
		s
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/&/g, ' and ')
			.replace(/['’]/g, '')
			.replace(/[^a-z0-9]+/g, ' ')
			.trim();

	function load() {
		loading ??= fetch('/search.json')
			.then((r) => r.json())
			.then((rows: Row[]) => {
				keys = rows.map((r) => normalize(r[1]));
				index = rows;
			});
		return loading;
	}

	onMount(() => {
		if (!compact) {
			const q = new URLSearchParams(location.search).get('q');
			if (q) {
				query = q;
				open = true;
				load();
			}
			return;
		}
		// "/" jumps to the header search from anywhere, like most search-first sites.
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			if (event.key !== '/' || target.closest('input, textarea, select, [contenteditable]')) return;
			event.preventDefault();
			input.focus();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	});

	let results = $derived.by(() => {
		const q = normalize(query);
		if (!index || q.length < 2) return [];
		const scored: { row: Row; score: number }[] = [];
		for (let i = 0; i < index.length; i++) {
			const k = keys[i];
			let score = 0;
			if (k === q) score = 4;
			else if (k.startsWith(q)) score = 3;
			else if (k.startsWith('the ' + q) || k.includes(' ' + q)) score = 2;
			else if (k.includes(q)) score = 1;
			if (score) scored.push({ row: index[i], score });
		}
		// Index is pre-sorted by popularity, so a stable sort keeps that as the tiebreak.
		return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.row);
	});

	let showResults = $derived(open && normalize(query).length >= 2);

	function describe([, , , reviews, mentions]: Row) {
		const parts = [];
		if (reviews) parts.push(`reviewed ${reviews === 1 ? 'once' : `${reviews} times`}`);
		if (mentions) parts.push(`mentioned in ${mentions} episode${mentions === 1 ? '' : 's'}`);
		return parts.join(', ');
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (results[0]) location.href = `/films/${results[0][0]}/`;
	}

	function onFocusOut(event: FocusEvent) {
		if (compact && !root.contains(event.relatedTarget as Node)) open = false;
	}

	// Arrow keys move between the input and the result links.
	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			open = false;
			input.focus();
			return;
		}
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const links = [...root.querySelectorAll<HTMLAnchorElement>('.results a')];
		if (!links.length) return;
		event.preventDefault();
		const at = links.indexOf(document.activeElement as HTMLAnchorElement);
		const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
		if (next < 0) input.focus();
		else links[Math.min(next, links.length - 1)].focus();
	}
</script>

<div class="search" class:compact bind:this={root} onfocusout={onFocusOut} onkeydown={onKeydown} role="presentation">
	<form role="search" onsubmit={submit}>
		<label for={id} class="visually-hidden">Search films and shows</label>
		<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"
			><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.5" /><path
				d="m15.5 15.5 5 5"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
			/></svg
		>
		<input
			{id}
			bind:this={input}
			type="search"
			autocomplete="off"
			spellcheck="false"
			placeholder={compact ? 'What did you just watch?' : 'Search films and shows'}
			aria-controls={`${id}-results`}
			aria-expanded={showResults}
			bind:value={query}
			onfocus={() => {
				open = true;
				load();
			}}
			oninput={() => {
				open = true;
				load();
			}}
		/>
		{#if compact}<kbd aria-hidden="true">/</kbd>{/if}
	</form>

	{#if showResults}
		<div class="results" id={`${id}-results`} aria-live="polite">
			{#if !index}
				<p class="msg">Loading the archive…</p>
			{:else if results.length === 0}
				<p class="msg">No episode mentions "{query}". Try fewer words, or check the spelling.</p>
			{:else}
				<ul>
					{#each results as row (row[0])}
						<li>
							<a href={`/films/${row[0]}/`}>
								<span class="t">{row[1]}{#if row[2]}{' '}<span class="y">({row[2]})</span>{/if}</span>
								<span class="d">{describe(row)}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	.search {
		position: relative;
	}

	form {
		position: relative;
	}

	.icon {
		position: absolute;
		left: 0.8rem;
		top: 50%;
		width: 1.1rem;
		height: 1.1rem;
		transform: translateY(-50%);
		color: var(--muted);
		pointer-events: none;
	}

	input {
		width: 100%;
		font: inherit;
		font-size: var(--step-1);
		padding: 0.7rem 0.9rem 0.7rem 2.5rem;
		border: 2px solid var(--line);
		border-radius: 0.5rem;
		background: var(--surface);
		color: var(--ink);
	}

	.compact input {
		font-size: var(--step-0);
		padding: 0.5rem 2.25rem 0.5rem 2.4rem;
		border-width: 1px;
		border-radius: 999px;
	}

	input:focus-visible {
		outline: none;
		border-color: var(--accent);
	}

	kbd {
		position: absolute;
		right: 0.7rem;
		top: 50%;
		transform: translateY(-50%);
		font: inherit;
		font-size: 0.75rem;
		line-height: 1;
		padding: 0.2rem 0.4rem;
		border: 1px solid var(--line);
		border-radius: 0.25rem;
		color: var(--muted);
		pointer-events: none;
	}

	input:focus ~ kbd {
		display: none;
	}

	.results {
		margin-top: 0.75rem;
	}

	.compact .results {
		position: absolute;
		z-index: 10;
		top: calc(100% + 0.4rem);
		left: 0;
		width: max(100%, min(30rem, calc(100vw - 2rem)));
		margin: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 0.6rem;
		box-shadow: 0 12px 32px color-mix(in srgb, var(--ink) 18%, transparent);
		overflow: hidden;
	}

	.msg {
		margin: 0;
		padding: 0.75rem 0.9rem;
		color: var(--muted);
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--surface);
		overflow: hidden;
	}

	.compact ul {
		border: 0;
		border-radius: 0;
	}

	li + li {
		border-top: 1px solid var(--line);
	}

	a {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.25rem 1rem;
		padding: 0.65rem 0.9rem;
		text-decoration: none;
	}

	a:hover,
	a:focus-visible {
		background: color-mix(in srgb, var(--accent) 10%, var(--surface));
		outline: none;
	}

	.t {
		font-weight: 700;
	}

	.y,
	.d {
		color: var(--muted);
		font-weight: 400;
	}

	.d {
		font-size: var(--step--1);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
