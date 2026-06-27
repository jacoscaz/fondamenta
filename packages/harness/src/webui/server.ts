
import { Server } from 'node:http';
import { createApp, type SessionListCallback } from './app.js';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { Logger } from 'pinetto';
import { InitContext, WithContext } from '../context.js';

export class WebUIServer extends WithContext {

  #app: Hono;
  #logger: Logger
  #server_http: Server;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child('[webui]');
    this.#app = createApp(
      ctx.config,
      this.#logger,
      this.#onSessionCreate,
      this.#onSessionList,
    );
    this.#server_http = serve({
      fetch: this.#app.fetch,
      port: ctx.config.webui.port,
      hostname: ctx.config.webui.addr,
    }, this.#onListening) as Server;
  }

  #onSessionCreate = async (): Promise<number> => {
    return await this._ctx.managers.sessions.createSession();
  };

  #onSessionList: SessionListCallback = async () => {
    return await this._ctx.managers.sessions.listSessions();
  };

  #onListening = () => {
    const address = this.#server_http.address();
    if (typeof address === 'string') {
      this.#logger.info('Listening on %s', address)
    } else if (typeof address === 'object'){
      this.#logger.info('Listening on %s:%s', address?.address, address?.port)
    } else {
      this.#logger.error('Listening (unknown address)');
    }
  }

  close() {
    this.#server_http.close();
  }

}
