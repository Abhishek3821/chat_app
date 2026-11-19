/*
 * Runs synchronously from <head>, BEFORE first paint (see index.html).
 *
 * It lives in its own file rather than inline because the production CSP
 * (vercel.json) is `script-src 'self'` — inline <script> blocks and inline
 * `onload=` attributes are refused there, which silently disabled both the
 * pre-paint theme (light-mode users got a dark flash) and the web font.
 */
(function () {
  // 1) Theme — resolve the stored preference before anything paints.
  try {
    var stored = localStorage.getItem('cc_theme') || 'dark';
    var dark = stored === 'dark' || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#071A2B' : '#E4F2EA');
    // theme-color <meta> comes after this script; fix it up once it exists.
    document.addEventListener('DOMContentLoaded', function () {
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', dark ? '#071A2B' : '#E4F2EA');
    });
  } catch (e) {
    /* private mode / storage blocked — fall through to the default */
  }

  // 2) Web font, non-render-blocking: load as media="print", then switch to
  //    "all" once loaded. A handler attached from script is CSP-safe.
  try {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';
    link.media = 'print';
    link.onload = function () {
      link.media = 'all';
    };
    document.head.appendChild(link);
  } catch (e) {
    /* the <noscript> fallback in index.html covers no-JS */
  }
})();
