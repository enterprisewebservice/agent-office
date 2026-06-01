/**
 * One-time auth capture for the Dev Hub UI E2E tests.
 *
 * The Dev Hub sign-in is GitHub OAuth (signInPage: github), so the tests
 * cannot log in by themselves. This opens a VISIBLE Chromium, you log in
 * via GitHub ONCE, and the resulting session (cookies + localStorage) is
 * saved to auth/storageState.json (gitignored). The tests then reuse it.
 *
 * Run:  npm run capture-auth
 * Re-run whenever the saved session expires (e.g. before a demo).
 */
import { chromium } from '@playwright/test';

const RHDH =
  process.env.RHDH_BASE_URL ||
  'https://v1-developer-hub-rhdh-test.apps.salamander.aimlworkbench.com';
const OUT = 'auth/storageState.json';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();

  // Go straight to the template catalog — it requires auth, so its content
  // only renders AFTER a successful GitHub login. That's our "logged in" signal.
  await page.goto(`${RHDH}/create`, { waitUntil: 'domcontentloaded' });

  console.log('\n============================================================');
  console.log('  Log in via GitHub in the browser window that just opened.');
  console.log('  Waiting (up to 5 min) for the Dev Hub template catalog…');
  console.log('============================================================\n');

  // Wait for the OpenClaw Agent template card to appear → we are authenticated.
  await page.getByText('OpenClaw Agent', { exact: false }).first().waitFor({
    state: 'visible',
    timeout: 5 * 60 * 1000,
  });

  await ctx.storageState({ path: OUT });
  console.log(`\n✓ Session saved to ${OUT}. Closing browser.\n`);
  await browser.close();
  process.exit(0);
})().catch((err) => {
  console.error('capture-auth failed:', err?.message || err);
  process.exit(1);
});
