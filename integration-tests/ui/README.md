# Dev Hub UI E2E (Playwright)

Browser-level integration tests that drive the **real** Red Hat Developer Hub
UI — the same wizard a human uses — to prove the platform's self-service flows
work end to end. Runs **visibly** (headed Chromium) by default so you can watch
it, and is fully idempotent (creates → verifies → tears down, no trace).

## One-time: capture a session
The Dev Hub sign-in is GitHub OAuth, so tests reuse a saved session.
```
npm install
npx playwright install chromium
npm run capture-auth        # a visible browser opens → log in via GitHub once
```
This writes `auth/storageState.json` (gitignored). Re-run it when the session
expires (e.g. before a demo).

## Tests
| Spec | What it proves |
|---|---|
| `tests/create-agent.spec.ts` | Create the **Genesis PM agent** via the openclaw-agent wizard → the scaffolder publishes the gitops repo, registers the catalog Component, and the operator reconciles the AgentWorkstation. Asserts the scaffolder task completes. |

```
npm test                    # visible (headed) by default
HEADLESS=1 npm test         # headless (CI)
KEEP_AGENT=1 npm test       # don't tear down — leave genesis-pm as the live demo agent
```

## Notes
- **Unified runtime:** there is no dedicated/shared flag — a created agent just
  joins its gateway (default `research-gateway`), like every other agent.
- **Idempotent teardown** (`scripts/cleanup-agent.sh`) removes the catalog
  Location, ArgoCD app, AgentWorkstation, and the gitops repo. The catalog
  Location matters: the scaffolder's `catalog:register` creates one that
  deleting the repo does NOT remove, so without this a re-run hits
  "addLocation already exists".
- **Empty description = 400:** Backstage rejects a null `metadata.description`
  ("must be string"). The test fills a description; the template
  (`openclaw-agent/skeleton/catalog-info.yaml`) also now defaults it.
