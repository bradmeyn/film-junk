<script lang="ts">
	import { onMount } from 'svelte';
	import type { SearchRow as Row } from '../lib/types';

	// compact: the header search. A button that opens a centred dialog (also on "/" and ⌘K / Ctrl+K).
	// Otherwise the search renders inline, as on the Films page.
	let { compact = false, limit = 8, id = 'film-search' }: { compact?: boolean; limit?: number; id?: string } = $props();

	let query = $state('');
	let active = $state(0);
	let index = $state<Row[] | null>(null);
	let keys: string[] = [];
	let loading: Promise<void> | null = null;
	let input = $state<HTMLInputElement>();
	let dialog = $state<HTMLDialogElement>();
	let isMac = $state(true);

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

	function open() {
		load();
		dialog?.showModal();
		input?.select();
	}

	function close() {
		dialog?.close();
	}

	onMount(() => {
		isMac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
		if (!compact) {
			const q = new URLSearchParams(location.search).get('q');
			if (q) {
				query = q;
				load();
			}
			return;
		}
		// "/" or ⌘K / Ctrl+K opens the search from anywhere, like most search-first sites.
		const onKey = (event: KeyboardEvent) => {
			const shortcut = (event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey);
			const target = event.target as HTMLElement;
			const typing = target.closest('input, textarea, select, [contenteditable]');
			if (!shortcut && (event.key !== '/' || typing)) return;
			event.preventDefault();
			if (dialog?.open) close();
			else open();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	});

	let results = $derived.by(() => {
		const q = normalize(query);
		if (!index) return [];
		// Before typing, the dialog suggests the most-discussed films (the index is sorted that way).
		if (q.length < 2) return compact ? index.slice(0, 6) : [];
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

	let typed = $derived(normalize(query).length >= 2);
	let showResults = $derived(compact || typed);

	// Keep the highlight on the first result whenever the list changes.
	$effect(() => {
		results;
		active = 0;
	});

	function describe([, , , reviews, mentions]: Row) {
		const parts = [];
		if (reviews) parts.push(`reviewed ${reviews === 1 ? 'once' : `${reviews} times`}`);
		if (mentions) parts.push(`mentioned in ${mentions} episode${mentions === 1 ? '' : 's'}`);
		return parts.join(', ');
	}

	const href = (row: Row) => `/films/${row[0]}/`;
	const poster = (row: Row) => (row[5] ? `https://image.tmdb.org/t/p/w92/${row[5]}.jpg` : null);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const row = results[active];
		if (row) location.href = href(row);
	}

	// Arrow keys move the highlight while focus stays in the input.
	function onInputKeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		if (!results.length) return;
		event.preventDefault();
		const step = event.key === 'ArrowDown' ? 1 : -1;
		active = (active + step + results.length) % results.length;
		document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
	}

	// A click on the backdrop (the dialog element itself, outside the panel) closes it.
	function onDialogClick(event: MouseEvent) {
		if (event.target === dialog) close();
	}
</script>

{#snippet searchBox()}
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
			role="combobox"
			aria-autocomplete="list"
			autocomplete="off"
			spellcheck="false"
			placeholder="Search films and shows"
			aria-controls={`${id}-results`}
			aria-expanded={showResults && results.length > 0}
			aria-activedescendant={results.length ? `${id}-opt-${active}` : undefined}
			bind:value={query}
			onfocus={load}
			oninput={load}
			onkeydown={onInputKeydown}
		/>
		{#if compact}<kbd class="esc" aria-hidden="true">esc</kbd>{/if}
	</form>
{/snippet}

{#snippet resultList()}
	{#if showResults}
		<div class="results" aria-live="polite">
			{#if !index}
				<p class="msg">Loading the archive…</p>
			{:else if typed && results.length === 0}
				<p class="msg">No episode mentions "{query}". Try fewer words, or check the spelling.</p>
			{:else}
				{#if !typed}<p class="hint">Most discussed</p>{/if}
				<ul id={`${id}-results`} role="listbox" aria-label="Films">
					{#each results as row, i (row[0])}
						<li id={`${id}-opt-${i}`} role="option" aria-selected={i === active} class:active={i === active}>
							<a href={href(row)} tabindex="-1" onmouseenter={() => (active = i)}>
								{#if poster(row)}
									<img src={poster(row)} alt="" width="92" height="138" loading="lazy" />
								{:else}
									<span class="noposter" aria-hidden="true">{row[1].slice(0, 1)}</span>
								{/if}
								<span class="text">
									<span class="t">{row[1]}{#if row[2]}{' '}<span class="y">({row[2]})</span>{/if}</span>
									<span class="d">{describe(row)}</span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
{/snippet}

{#if compact}
	<button type="button" class="trigger" onclick={open} onmouseenter={load} aria-haspopup="dialog">
		<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"
			><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.5" /><path
				d="m15.5 15.5 5 5"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
			/></svg
		>
		<span>Search films and shows</span>
		<kbd aria-hidden="true">{isMac ? '⌘' : 'Ctrl'} K</kbd>
	</button>

	<dialog bind:this={dialog} class="palette" aria-label="Search films and shows" onclick={onDialogClick}>
		<div class="panel">
			{@render searchBox()}
			{@render resultList()}
			<p class="keys" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> to move <kbd>↵</kbd> to open <kbd>esc</kbd> to close</p>
		</div>
	</dialog>
{:else}
	<div class="search inline">
		{@render searchBox()}
		{@render resultList()}
	</div>
{/if}

<style>
	form {
		position: relative;
	}

	.icon {
		position: absolute;
		left: 0.9rem;
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
		padding: 0.75rem 3.5rem 0.75rem 2.6rem;
		border: 2px solid var(--line);
		border-radius: 0.5rem;
		background: var(--surface);
		color: var(--ink);
	}

	input:focus-visible {
		outline: none;
		border-color: var(--accent);
	}

	/* Hide the browser's own clear button; esc clears and closes. */
	input::-webkit-search-cancel-button {
		display: none;
	}

	kbd {
		font: inherit;
		font-size: 0.75rem;
		line-height: 1;
		padding: 0.2rem 0.4rem;
		border: 1px solid var(--line);
		border-radius: 0.25rem;
		color: var(--muted);
	}

	.esc {
		position: absolute;
		right: 0.8rem;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
	}

	/* ---------- header trigger: looks like a search box */

	.trigger {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		font: inherit;
		text-align: left;
		padding: 0.5rem 0.6rem 0.5rem 2.5rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--surface);
		color: var(--muted);
		cursor: pointer;
	}

	.trigger .icon {
		left: 0.8rem;
	}

	.trigger span {
		flex: 1;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.trigger:hover {
		border-color: var(--muted);
	}

	/* ---------- dialog */

	.palette {
		width: min(38rem, calc(100vw - 2rem));
		max-height: min(36rem, calc(100dvh - 4rem));
		margin: 12vh auto auto;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 0.8rem;
		background: var(--surface);
		color: var(--ink);
		box-shadow: 0 24px 64px rgb(0 0 0 / 0.45);
		overflow: hidden;
	}

	.palette[open] {
		display: flex;
		animation: pop 0.14s ease-out;
	}

	.palette::backdrop {
		background: rgb(8 6 20 / 0.55);
		backdrop-filter: blur(6px);
	}

	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(-6px) scale(0.98);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.palette[open] {
			animation: none;
		}
	}

	.panel {
		display: flex;
		flex-direction: column;
		width: 100%;
		min-height: 0;
	}

	.palette form {
		border-bottom: 1px solid var(--line);
	}

	.palette input {
		border: 0;
		border-radius: 0;
		background: transparent;
		padding-block: 1rem;
	}

	.palette .results {
		overflow-y: auto;
		padding: 0.4rem;
	}

	.hint {
		margin: 0.4rem 0.6rem 0.2rem;
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--muted);
	}

	.keys {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		margin: 0;
		padding: 0.55rem 0.9rem;
		border-top: 1px solid var(--line);
		font-size: 0.75rem;
		color: var(--muted);
	}

	.keys kbd + kbd {
		margin-left: -0.1rem;
	}

	/* On phones the dialog sits at the top, so the keyboard doesn't cover it; no shortcut hints. */
	@media (max-width: 40rem) {
		.palette {
			margin-top: 1rem;
		}
		.keys,
		.trigger kbd {
			display: none;
		}
	}

	/* ---------- results */

	.inline .results {
		margin-top: 0.75rem;
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
	}

	.inline ul {
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		background: var(--surface);
		overflow: hidden;
	}

	.inline li + li {
		border-top: 1px solid var(--line);
	}

	a {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.45rem 0.6rem;
		border-radius: 0.45rem;
		text-decoration: none;
	}

	.inline a {
		border-radius: 0;
	}

	li.active a {
		background: color-mix(in srgb, var(--accent) 16%, var(--surface));
	}

	img,
	.noposter {
		flex: none;
		width: 2.4rem;
		aspect-ratio: 2 / 3;
		height: auto;
		border-radius: 0.25rem;
		object-fit: cover;
		background: var(--line);
	}

	.noposter {
		display: grid;
		place-items: center;
		font-weight: 800;
		color: var(--muted);
	}

	.text {
		display: grid;
		gap: 0.1rem;
		min-width: 0;
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
