import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    // The Player's machine serves these as plain files; there is no server to render on.
    adapter: adapter({ fallback: 'index.html' })
  }
};
