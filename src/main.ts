// main.ts — application bootstrap

// Fonts (self-hosted via @fontsource; works fully offline — no Google Fonts CDN).
// latin-only subsets: the default weight CSS pulls every unicode subset
// (cyrillic, greek, vietnamese, …) into the bundle; non-latin glyphs fall back
// to system fonts.
import '@fontsource/hanken-grotesk/latin-400.css';
import '@fontsource/hanken-grotesk/latin-500.css';
import '@fontsource/hanken-grotesk/latin-600.css';
import '@fontsource/hanken-grotesk/latin-700.css';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';

// Global design system
import './app.css';

import App from './App.svelte';

const app = new App({
  target: document.getElementById('app') as HTMLElement,
});

export default app;
