
import { is, ReceiveType, resolveReceiveType } from '@runtyped/type';
import { uid } from "uid";
import { JsonRpcClient, JsonRpcParams, JsonRpcRequest, JsonRpcMessage, isJsonRpcResponse } from '@fondamenta/mcp-core';

export class JsonRpcHttpClient implements JsonRpcClient {

  #url: URL;

  constructor(url: URL) {
    this.#url = url;
  }

  async call<R>(method: string, params?: JsonRpcParams, __type_R?: ReceiveType<R>): Promise<R> {
    __type_R = resolveReceiveType(__type_R);
    const req_body = {
      jsonrpc: '2.0',
      id: uid(),
      method,
      params,
    } satisfies JsonRpcRequest;
    const res = await fetch(this.#url, {
      method: 'POST',
      body: JSON.stringify(req_body),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (res.ok) {
      let res_body = await res.json();
      if (!Array.isArray(res_body)) {
        res_body = [res_body];
      }
      if (is<JsonRpcMessage[]>(res_body)) {
        for (const message of res_body) {
          if (isJsonRpcResponse(message)) {
            if ('result' in message) {
              const { result } = message;
              if (is<R>(result, undefined, undefined, __type_R)) {
                return result;
              }
              throw new Error('Invalid response: malformed result.');
            }
            throw new Error('Tool call error: ' + message.error.message);
          }
        }
        throw new Error('Invalid response: no matching response.');
      }
      throw new Error('Invalid response: bad JSON-RPC payload.');
    }
    throw new Error('Invalid response: server responded with status code ' + res.status);
  }

}
