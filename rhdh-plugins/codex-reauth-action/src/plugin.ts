/*
 * codex-reauth backend plugin.
 *
 * Used to be a `backend-plugin-module` registering a `codex:reauth`
 * scaffolder action. That model forced any caller (e.g., the
 * codex-reauth-ui dialog) to go through Backstage's scaffolder
 * task machinery, which in turn requires a template entity in the
 * catalog. The user doesn't want a separate template on /create.
 *
 * Re-shaped as a full backend plugin that owns an HTTP route at:
 *
 *   POST /api/codex-reauth/write
 *     body: { idToken, accessToken, refreshToken, accountId?,
 *             vaultPath? }
 *     reply: { vaultVersion }  (200) or { error } (4xx/5xx)
 *
 * The frontend dialog hits this directly via Backstage's fetchApi
 * (so the request carries the user's identity token; Backstage's
 * backend default auth policy then admits it). No template
 * anywhere in the path.
 *
 * Why a backend plugin (not module): only full backend plugins own
 * a top-level httpRouter that mounts under /api/<pluginId>. Modules
 * extend existing plugins via extension points and can't claim a
 * new HTTP path.
 */
import { createBackendPlugin, coreServices } from '@backstage/backend-plugin-api';
import { Router } from 'express';
import express from 'express';
import { writeCodexAuthJson } from './vault';

interface WriteRequestBody {
  idToken?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
  accountId?: unknown;
  vaultPath?: unknown;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`required string field missing: ${field}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('expected string or omitted field');
  return value;
}

export const codexReauthPlugin = createBackendPlugin({
  pluginId: 'codex-reauth',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
      },
      async init({ httpRouter, logger }) {
        const router: Router = express.Router();
        router.use(express.json({ limit: '64kb' }));

        router.post('/write', async (req, res) => {
          const log = (msg: string) => logger.info(`[codex-reauth] ${msg}`);
          try {
            const body = (req.body ?? {}) as WriteRequestBody;
            const result = await writeCodexAuthJson(
              {
                idToken: asString(body.idToken, 'idToken'),
                accessToken: asString(body.accessToken, 'accessToken'),
                refreshToken: asString(body.refreshToken, 'refreshToken'),
                accountId: optionalString(body.accountId),
                vaultPath: optionalString(body.vaultPath),
              },
              log,
            );
            res.json(result);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`[codex-reauth] write failed: ${message}`);
            res.status(500).json({ error: message });
          }
        });

        httpRouter.use(router);
      },
    });
  },
});

export default codexReauthPlugin;
