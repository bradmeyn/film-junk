import type { APIRoute } from 'astro';

// Everything is public; point crawlers at the sitemap when the site address is known.
export const GET: APIRoute = ({ site }) => {
	const lines = ['User-agent: *', 'Allow: /'];
	if (site) lines.push('', `Sitemap: ${new URL('sitemap-index.xml', site).href}`);
	return new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'text/plain' } });
};
