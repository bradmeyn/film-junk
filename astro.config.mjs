// @ts-check
import { defineConfig } from 'astro/config';

import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';

// The public URL, for canonical links, share previews and the sitemap.
const site = 'https://filmjunkpodcast.com';

// https://astro.build/config
export default defineConfig({
  site,
  integrations: [
    svelte(),
    // Utility pages that shouldn't show up in search results.
    sitemap({ filter: (page) => !/\/(random|404)\/?$/.test(page) }),
  ],
  redirects: { '/years': '/episodes/', '/premiums': '/commerce/#premiums' },
  // Inline the (small) stylesheets so the first paint doesn't wait on a CSS request.
  build: { inlineStylesheets: 'always' },
});
