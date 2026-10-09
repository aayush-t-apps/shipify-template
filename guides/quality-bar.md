# Quality bar

✅ means the shared tests or `ship validate` check it automatically. The rest is reviewed against the plan.

## Every app
- ✅ `make verify` passes: format, lint, types, unit tests at 80% coverage or more, and browser
  tests on desktop and phone.
- ✅ No console errors on load. `/health` answers.
- ✅ Accessibility: no serious or critical axe violations (exceptions need a written reason in
  `tests/e2e/a11y-exceptions.json`).
- ✅ Phone at 360px: no horizontal scroll, and tap targets at least 24×24px (aim for 44px).
  Accepted exceptions, with reasons, go in `tests/e2e/quality.json`.
- ✅ Performance: initial JavaScript within budget. The defaults are 170 KB for `ts-worker` apps
  and 80 KB for `ts-static` sites, transferred and compressed. Exceptions go in
  `tests/e2e/quality.json`, each with a reason.
- Keyboard: everything works by keyboard, with a visible focus ring that isn't hidden under
  sticky bars.
- Inputs: every input has a label, text inputs are at least 16px (so iOS doesn't zoom), and errors
  appear next to the field.
- Motion: `prefers-reduced-motion` is honoured. Animate only transform and opacity.
- Images: explicit width and height, and lazy loading below the fold.
- Targets (Core Web Vitals, phone on 4G): LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.

## If the plan says offline or installable
- A manifest with name, short_name, start_url, `display: standalone`, and 192px, 512px and
  maskable icons.
- A service worker: the app shell is precached, pages and data are fetched network-first, images
  and fonts are cache-first, and there's an offline fallback page.
- A test that loads a page, goes offline, reloads, and the page still works.
