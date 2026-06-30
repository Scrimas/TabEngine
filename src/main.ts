// main.ts — application bootstrap

// Inter font (self-hosted via @fontsource; works fully offline)
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

// Global design system
import './app.css';

import App from './App.svelte';

const app = new App({
  target: document.getElementById('app') as HTMLElement,
});

export default app;
