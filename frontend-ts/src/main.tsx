import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { bootScore } from './services/sfx';
import { startLiveUpdates } from './services/queryClient';
import './styles/reset.css';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/guide.css';
import './styles/fonts.css';
import './styles/landing.css';
import './styles/live.css';
import './styles/notifications.css';
import './styles/app.css';
import './styles/responsive/login-desktop.css';
import './styles/responsive/login-mobile.css';
import './styles/login-transition.css';

// Pages are separate files named after their contents (routes.ts). A tab left open across a
// redeploy still asks for the old names, which are gone; reload it once to pick up the new build.
// The timestamp guard stops a reload loop if the files are missing for some other reason.
window.addEventListener('vite:preloadError', () => {
  const KEY = 'itrs-chunk-reload';
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY)) || 0;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return; // storage blocked: no way to guard against a loop, so leave it to a manual refresh
  }
  if (Date.now() - last > 10_000) window.location.reload();
});

// Socket events mark cached server data stale (services/queryClient.ts).
startLiveUpdates();

const render = () =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

// Landing visits start behind the boot loader in index.html. Keep it up for a short beat (and
// until the headline fonts are in, within reason), then mount the app as it fades so the
// landing page's own entrance plays in view.
const boot = document.getElementById('boot');
if (boot && document.documentElement.classList.contains('boot')) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const minDelay = Math.max(0, (reduced ? 300 : 1200) - performance.now());
  const fonts = Promise.all([
    document.fonts.load("700 1em 'Plus Jakarta Sans'"),
    document.fonts.load("400 1em 'Inter'"),
  ]).catch(() => undefined);
  const fontsOrTimeout = Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]);

  const finish = (window as Window & { __bootFinish?: () => Promise<void> }).__bootFinish;

  // Sound for the loader (services/sfx.ts): scored where the browser allows it on load. Where it
  // does not (address bar, search result), the opening plays silently rather than waiting on a tap.
  const score = bootScore();
  window.addEventListener('boot-step', (e) => score?.step((e as CustomEvent<number>).detail));

  Promise.all([new Promise((r) => setTimeout(r, minDelay)), fontsOrTimeout])
    .then(() => finish?.())
    .then(() => {
      render();
      document.documentElement.classList.add('boot-done');
      score?.open();
      setTimeout(() => boot.remove(), 1300);
    });
} else {
  boot?.remove();
  render();
}
