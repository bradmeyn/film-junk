// Exports Film Junk's Patreon post list (titles, dates, links; no paid content).
// Patreon blocks automated requests, so run this in your own browser:
//   1. Open https://www.patreon.com/filmjunk
//   2. Open the developer console (Cmd+Option+J), paste this file, press Enter
//   3. Move the downloaded patreon-posts.json into data/, then run `npm run data:build`
(async () => {
	const html = document.documentElement.innerHTML;
	const campaignId = (
		html.match(/"campaign"\s*:\s*\{\s*"data"\s*:\s*\{\s*"id"\s*:\s*"(\d+)"/) ??
		html.match(/campaign_id=(\d+)/) ??
		html.match(/"campaignId"\s*:\s*"?(\d+)/)
	)?.[1];
	if (!campaignId) throw new Error('Could not find the campaign id on this page. Are you on patreon.com/filmjunk?');

	const posts = [];
	let url =
		`/api/posts?filter[campaign_id]=${campaignId}&filter[contains_exclusive_posts]=true&filter[is_draft]=false` +
		'&sort=-published_at&fields[post]=title,published_at,url&json-api-version=1.0&page[count]=50';
	while (url) {
		const res = await fetch(url, { credentials: 'include' });
		if (!res.ok) throw new Error(`Patreon API returned ${res.status}`);
		const page = await res.json();
		for (const p of page.data)
			posts.push({ title: p.attributes.title, date: p.attributes.published_at.slice(0, 10), url: p.attributes.url });
		console.log(`${posts.length} posts…`);
		url = page.links?.next ?? null;
		await new Promise((r) => setTimeout(r, 300));
	}

	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([JSON.stringify(posts, null, '\t')], { type: 'application/json' }));
	a.download = 'patreon-posts.json';
	a.click();
	console.log(`Saved ${posts.length} posts.`);
})();
