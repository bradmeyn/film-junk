// @ts-check
import { defineConfig } from 'astro/config';

import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import { loadEnv } from 'vite';

// The public URL, for canonical links, share previews and the sitemap. Set SITE_URL in the
// Cloudflare build settings (or .env) once the site has its address; without it those are skipped.
const site = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '').SITE_URL || undefined;

// https://astro.build/config
export default defineConfig({
  site,
  integrations: [
    svelte(),
    // Utility pages that shouldn't show up in search results.
    sitemap({ filter: (page) => !/\/(random|404)\/?$/.test(page) }),
  ],
  redirects: { '/years': '/episodes/' }
});
