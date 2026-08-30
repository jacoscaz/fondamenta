
import { cast, ValidationError } from '@runtyped/type';
import { validationErrsToString } from "@fondamenta/utils";

// ============================================================================
//                                  HELPERS
// ============================================================================

import { JsonRpcMessage, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from "./types-jsonrpc.js";

export const isJsonRpcNotification = (message: JsonRpcMessage): message is JsonRpcNotification => {
  return !('id' in message) && ('method' in message);
};

export const isJsonRpcResponse = (message: JsonRpcMessage): message is JsonRpcResponse => {
  return ('id' in message) && !('method' in message);
};

export const isJsonRpcRequest = (message: JsonRpcMessage): message is JsonRpcRequest => {
  return ('id' in message) && ('method' in message);
};

export const validateJsonRpcMessage = (message: any): JsonRpcMessage => {
  if (Buffer.isBuffer(message)) {
    message = message.toString();
  }
  if (typeof message === 'string') {
    try {
      message = JSON.parse(message);
    } catch (err) {
      throw new Error('Invalid JSON-RPC message: bad JSON.')
    }
  }
  try {
    return cast<JsonRpcMessage>(message);
  } catch (err) {
    throw new Error(`Invalid JSON-RPC message: ${validationErrsToString((err as ValidationError).errors)}`);
  }
}
