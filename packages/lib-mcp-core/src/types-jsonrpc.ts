
export interface JsonRpcBase {
  jsonrpc: '2.0';
}

export type JsonRpcParams = any[] | { [key: string]: any };

// ============================================================================
//                                REQUEST
// ============================================================================

export interface JsonRpcRequest extends JsonRpcBase {
    id: string | number;
    method: string;
    params?: JsonRpcParams | undefined;
}

//
// ERROR CODES
// -----

export enum JsonRpcStandardErrorCodes {
  /** Parse error	Invalid JSON was received by the server. An error occurred on the server while parsing the JSON text. */
  ParseError = -32700,
  /** Invalid Request	The JSON sent is not a valid Request object. */
  InvalidRequest = -32600,
  /** Method not found	The method does not exist / is not available. */
  MethodNotFound = -32601,
  /** Invalid params	Invalid method parameter(s). */
  InvalidParams = -32602,
  /** Internal error	Internal JSON - RPC error. */
  InternalError = -32603,
}

export enum JsonRpcServerErrorCodes {
  /** Server error	Generic server error, used when no more specific error is applicable. */
  ServerError = - 32000,
  /** Server overloaded	Server is currently unable to handle the request due to a temporary overload. */
  ServerOverloaded = - 32001,
  /** Rate limit exceeded	Too many requests have been sent within a given time period. */
  RateLimitExceeded = - 32002,
  /** Session expired	The session or authentication has expired. */
  SessionExpired = - 32003,
  /** Method not ready	The method exists but is temporarily unavailable. */
  MethodNotReady = - 32004,
}

export enum JsonRpcReservedErrorCodes {
  /** Invalid batch request	The batch request contains an invalid or empty array. */
  InvalidBatchRequest = - 32040,
  /** Content-Type error	The Content-Type header is missing or not set to application/json. */
  ContentTypeError = -32050,
  /** Transport error	Error occurred during transport or connection. */
  TransportError = -32060,
  /** Timeout error	The request timed out before a response was received.   */
  TimeoutError = -32070,
}

export type JsonRpcErrorCode = JsonRpcStandardErrorCodes | JsonRpcReservedErrorCodes | JsonRpcServerErrorCodes;

// ============================================================================
//                                RESPONSES
// ============================================================================

export interface JsonRpcBaseResponse extends JsonRpcBase {
    id: string | number;
}

export interface JsonRpcResultResponse extends JsonRpcBaseResponse {
  result: any;
}

export interface JsonRpcErrorResponse extends JsonRpcBaseResponse {
  error: {
    code: JsonRpcErrorCode | number;
    message: string;
    data?: any;
  };
}

export type JsonRpcResponse = JsonRpcResultResponse | JsonRpcErrorResponse;

// ============================================================================
//                                NOTIFICATIONS
// ============================================================================

export interface JsonRpcNotification extends JsonRpcBase {
  method: string;
  params?: JsonRpcParams | undefined;
}

// ============================================================================
//                                UNION TYPES
// ============================================================================

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ============================================================================
//                             CLIENTS / SERVERS
// ============================================================================

export interface JsonRpcClient {
  call<R>(method: string, params?: JsonRpcParams): Promise<R>;
}
