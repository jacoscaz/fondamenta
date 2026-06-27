import { Hono } from 'hono';
import { ChatPage } from './components/chat-page.js';
import { Config } from '../config/config.js';
import { Logger } from 'pinetto';
import { errToString } from '@fondamenta/utils';
import { type SelectableSession } from '../database/tables/sessions.js';

export type HonoInstance = Hono;

export type SessionListCallback = () => Promise<(SelectableSession & { updated_at: Date | null })[]>;

/**
 * Creates the Hono application for the web chat interface.
 * Handles:
 * - GET / - creates new session and redirects
 * - GET /session/:id - serves chat page for session
 * - GET /sessions - returns JSON list of all sessions
 */
export const createApp = (
  config: Config,
  logger: Logger,
  onSessionCreate: () => Promise<number>,
  onSessionList: SessionListCallback,
): HonoInstance => {

  const app = new Hono();

  app.get('/', async (ctx) => {
    const session_id = await onSessionCreate();
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

  app.get('/sessions', async (ctx) => {
    const sessions = await onSessionList();
    return ctx.json(sessions);
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
