/**
 * Throwaway exploration spec — dumps the real DOM (field labels, input
 * names, buttons, step headings) of the openclaw-agent wizard so the
 * create-agent spec can target stable selectors. Not a real test.
 *
 *   npm run explore
 */
import { test } from '@playwright/test';

test('explore openclaw-agent wizard', async ({ page }) => {
  await page.goto('/create/templates/default/openclaw-agent', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(4000);

  const dump = await page.evaluate(() => {
    const t = (el: Element | null) =>
      (el?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    return {
      url: location.href,
      stepHeadings: Array.from(
        document.querySelectorAll('.MuiStepLabel-label, [class*="stepLabel"]'),
      )
        .map((x) => t(x))
        .filter(Boolean),
      labels: Array.from(document.querySelectorAll('label'))
        .map((l) => t(l))
        .filter(Boolean),
      inputs: Array.from(document.querySelectorAll('input, textarea')).map(
        (i) => ({
          name: i.getAttribute('name'),
          id: i.id || null,
          type: i.getAttribute('type'),
          aria: i.getAttribute('aria-label'),
          placeholder: i.getAttribute('placeholder'),
        }),
      ),
      buttons: Array.from(document.querySelectorAll('button'))
        .map((b) => t(b))
        .filter(Boolean),
    };
  });

  console.log('EXPLORE_DUMP=' + JSON.stringify(dump, null, 2));
});
