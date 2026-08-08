import { type WebSocket, WebSocketServer } from 'ws';
import { type Logger } from 'pinetto';
import { type Message, UserMessage } from '../models/session/types/messages.js';
import { type IncomingMessage } from 'node:http';
import { addressInfoToString, errToString } from '@fondamenta/utils';
import { cast } from '@runtyped/type';
import { type InitContext, WithContext } from '../context.js';
import { type SessionRunner } from '../sessions/runner.js';

export class IOManager extends WithContext {

  #logger: Logger;
  #server: WebSocketServer;

  constructor(ctx: InitContext) {
    super(ctx);
    this.#logger = ctx.logger.child(`[io]`);
    this.#server = new WebSocketServer({
      host: ctx.config.io.addr,
      port: ctx.config.io.port,
      path: ctx.config.io.path,
    });
    this.#server.on('connection', this.#onConnection);
    this.#server.on('listening', this.#onListening);
  }

  #onListening = () => {
    this.#logger.info('listening on %s', addressInfoToString(this.#server.address()!));
  };

  #onResume = (ws: WebSocket, runner: SessionRunner) => {
    const session_id = runner.session_id;

    const onWSMessage = (data: string | Buffer) => {
      ws.pause();
      (async () => {
        try {
          data = Buffer.isBuffer(data) ? data.toString() : data;
          console.log('received message: %s', data);
          const message = cast<UserMessage>(JSON.parse(data));
          await runner.addMessage(message);
        } catch (err) {
          this.#logger.error('invalid message');
          console.log(err);
        }
      })().finally(() => {
        ws.resume();
      });
    };

    const onWSError = (err: unknown) => {
      this.#logger.error('channel error: %s', errToString(err));
    };

    const onWSClose = () => {
      ws.removeListener('message', onWSMessage);
      ws.removeListener('close', onWSClose);
      ws.removeListener('error', onWSError);
      runner.removeListener(`session-${session_id}-message`, onSessionMessage);
    };

    const onSessionMessage = (message: Message) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(message));
      }
    };

    ws.on('message', onWSMessage);
    ws.on('close', onWSClose);
    ws.on('error', onWSError);
    runner.on(`session-${session_id}-message`, onSessionMessage);
  };

  #onConnection = (ws: WebSocket, req: IncomingMessage) => {
    this.#logger.info('new connection from %s:%s',
      req.socket.remoteAddress, req.socket.remotePort);
    if (!req.url) {
      ws.terminate();
      console.error('bad URL');
      return;
    }

    const session_id = parseInt(new URL(req.url, 'ws://base.url').searchParams.get('session_id') ?? '');
    if (!Number.isSafeInteger(session_id)) {
      ws.terminate();
      console.error('bad session id');
      return;
    }
    const runner = this._ctx.managers.runners.ensure(session_id);
    runner.getHistory()
      .then((messages) => {
        for (const m of messages) {
          ws.send(JSON.stringify(m));
        }
        this.#onResume(ws, runner);
      })
      .catch((err) => {
        ws.terminate();
        console.error('resume error', err);
      });
  };

  close() {
    this.#server.close();
    this.#server.clients.forEach(c => c.close());
  }


}
