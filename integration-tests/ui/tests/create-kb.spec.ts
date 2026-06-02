/**
 * E2E: create + populate a Knowledge Base through the Dev Hub UI.
 *
 * Drives the openclaw-agent wizard with the "Also create a NEW knowledge
 * base" box checked + a first-principles topic. The scaffolder then ALSO
 * publishes a <name>-wiki repo seeded with content and emits a
 * KnowledgeBase CR; the operator provisions its PVC and (on the agent's
 * gateway) attaches it. This is the UI-driven sibling of the
 * `beat-knowledgebase` integration beat.
 *
 * Asserts the reliable create+populate facts: the wiki repo is published +
 * seeded (README), and the KnowledgeBase CR is applied. (The gateway attach
 * is downstream/async and not required for "created + populated".)
 *
 * NOTE: unified runtime — the KB agent joins the default gateway
 * (research-gateway), so the operator will transiently attach this KB there
 * and detach it on cleanup. Use KEEP_AGENT=1 to keep genesis-kb + its KB as
 * a live demo artifact.
 *
 * IDEMPOTENT: pre/post cleanup removes the KnowledgeBase CR, both repos
 * (<name>-agent-gitops + <name>-wiki), the catalog Location, the ArgoCD
 * app, and the AgentWorkstation.
 */
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

const NAME = process.env.KB_AGENT || 'genesis-worker';
const DISPLAY = process.env.DISPLAY_NAME || 'Genesis Worker';
const ROLE = process.env.ROLE || 'worker';
const DESC =
  process.env.AGENT_DESC ||
  'Genesis demo worker agent — trains the predictive model, moves the kanban cards, and owns the first-principles knowledge base.';
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  'You are the Genesis Model worker agent. Pick up tasks from the GitHub project board, train the predictive model with your genesis-train skill (gradient descent recovering y=wx+b on OpenShift AI / DSPA), move your kanban cards as you work, and curate the first-principles knowledge base documenting what you learn.';
const NS = 'agent-office';
const OWNER = 'enterprisewebservice';
const KEEP = process.env.KEEP_AGENT === '1';
const TOPIC =
  process.env.KB_TOPIC ||
  'First principles of model creation: data, hypothesis (y=wx+b), loss (MSE), gradient descent, evaluation.';

function cleanup(label: string) {
  console.log(`\n--- ${label} cleanup of ${NAME} (+ KB) ---`);
  try {
    execSync(`bash scripts/cleanup-agent.sh ${NAME} ${NS} ${OWNER}`, {
      stdio: 'inherit',
    });
  } catch (e) {
    console.warn('cleanup warning:', (e as Error).message);
  }
}

test.beforeAll(() => cleanup('pre'));
test.afterAll(() => {
  if (KEEP) {
    console.log(`\nKEEP_AGENT=1 → leaving ${NAME} + KB in place.`);
    return;
  }
  cleanup('post');
});

test('create + populate a KB via the openclaw-agent wizard', async ({
  page,
}) => {
  test.setTimeout(10 * 60 * 1000);

  await page.goto('/create/templates/default/openclaw-agent', {
    waitUntil: 'domcontentloaded',
  });

  // ---- Page 1: Identity ----
  await page.locator('#root_name').fill(NAME);
  await page.locator('#root_displayName').fill(DISPLAY);
  await page.locator('#root_description').fill(DESC);
  const owner = page.locator('#root_owner');
  await owner.click();
  await owner.fill('deanpeterson');
  await page
    .getByRole('option')
    .filter({ hasText: /deanpeterson|Dean Peterson/i })
    .first()
    .click({ timeout: 8000 })
    .catch(() => owner.press('Enter'));

  // ---- advance, filling fields as their pages appear ----
  let kbChecked = false;
  for (let step = 0; step < 10; step++) {
    // Page 2
    const role = page.locator('#root_role');
    if ((await role.count()) && (await role.isVisible())) await role.fill(ROLE);
    const sp = page.locator('#root_systemPrompt');
    if ((await sp.count()) && (await sp.isVisible())) {
      if (!(await sp.inputValue().catch(() => ''))) {
        await sp.fill(SYSTEM_PROMPT);
      }
    }

    // Page 4 (Compose): check "create new KB" + fill the topic
    const kbBox = page.locator('#root_createNewKnowledgeBase');
    if (!kbChecked && (await kbBox.count()) && (await kbBox.isVisible())) {
      await kbBox.check().catch(async () => {
        await page.getByText(/Also create a NEW knowledge base/i).click();
      });
      const topic = page.locator('#root_newKnowledgeBaseTopic');
      await topic.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      if (await topic.count()) await topic.fill(TOPIC);
      kbChecked = true;
    }

    const create = page.getByRole('button', { name: /^Create$/ });
    const review = page.getByRole('button', { name: /^Review$/ });
    const next = page.getByRole('button', { name: /^Next$/ });
    if ((await review.count()) && (await review.isVisible())) {
      await review.click();
      break;
    }
    if ((await create.count()) && (await create.isVisible())) break;
    if ((await next.count()) && (await next.isVisible())) {
      await next.click();
      await page.waitForTimeout(700);
      continue;
    }
    break;
  }

  expect(kbChecked, 'should have checked "create new KB" on the Compose page').toBe(
    true,
  );

  // ---- Review sanity, then Create ----
  await expect(page.getByText(NAME).first()).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /^Create$/ }).click();

  // ---- scaffolder completes ----
  await page.waitForURL(/\/tasks\/[0-9a-f-]+/, { timeout: 60000 });
  const taskId = page.url().match(/\/tasks\/([0-9a-f-]+)/)?.[1];
  expect(taskId, 'should navigate to a scaffolder task page').toBeTruthy();
  console.log(`\nscaffolder task: ${taskId} — polling for completion…`);
  execSync(`bash scripts/wait-task.sh ${taskId}`, { stdio: 'inherit' });

  await page
    .screenshot({ path: 'test-results/create-kb-done.png', fullPage: true })
    .catch(() => {});

  // ---- assert the KB was created + populated ----
  console.log(`\nasserting KB ${NAME}-wiki created + populated…`);
  execSync(`bash scripts/assert-kb.sh ${NAME} ${NS} ${OWNER}`, {
    stdio: 'inherit',
  }); // throws on failure
  console.log(`\n✓ ${NAME}-wiki created + populated via the UI.`);

  // ---- seed the REAL first-principles vault into the KB ----
  // The scaffolder only publishes a stub wiki. Push the genesis-first-principles
  // Obsidian vault (12 linked notes grounded in pipeline.py) into the wiki repo
  // so the KB gitMirror makes the agent actually TEACH from first principles —
  // not just carry an empty shell. This is what makes the KB meaningful.
  console.log(`\nseeding genesis-first-principles vault into ${NAME}-wiki…`);
  execSync(`bash scripts/seed-genesis-kb.sh ${NAME} ${OWNER}`, {
    stdio: 'inherit',
  }); // throws on failure
  console.log(`\n✓ ${NAME}-wiki now teaches from the genesis-first-principles vault.`);
});
