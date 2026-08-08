import { Hono } from 'hono';
import { ChatPage } from './components/chat-page.js';
import { Config } from '../config/config.js';
import { Logger } from 'pinetto';
import { errToString } from '@fondamenta/utils';

export type HonoInstance = Hono;

/**
 * Creates the Hono application for the web chat interface.
 * Single-session: there is one main session. The root route
 * redirects to it; session switching is not available.
 *
 * Handles:
 * - GET / - redirects to the main session
 * - GET /session/:id - serves chat page for session
 */
export const createApp = (
  config: Config,
  logger: Logger,
  onMainSession: () => Promise<number>,
): HonoInstance => {

  const app = new Hono();

  app.get('/', async (ctx) => {
    const session_id = await onMainSession();
    return ctx.redirect(`/session/${session_id}`, 302);
  });

  app.get('/session/:id', async (ctx) => {
    const session_id = parseInt(ctx.req.param('id'));
    if (!Number.isSafeInteger(session_id)) {
      return ctx.json({ error: 'bad session id' });
    }
    return ctx.html(<ChatPage
      session_id={session_id}
      io_host={config.io.addr === '0.0.0.0' ? 'localhost' : config.io.addr}
      io_port={config.io.port}
    />);
  });

  app.onError((err, ctx) => {
    logger.error('[HTTP] Error:', errToString(err));
    return ctx.json(
      {
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  });

  return app;
};
