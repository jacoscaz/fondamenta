import {
  cast,
  Type,
  ValidationError,
  toJsonSchema,
} from '@runtyped/type';

import {
  type McpToolCallResult,
  type McpContentBlock,
  type McpToolDescriptor,
  type McpToolFnResult,
} from "@fondamenta/mcp-core";

import {
  errToString,
  validationErrsToString,
} from "@fondamenta/utils";
import { McpToolCallContext } from "@fondamenta/mcp-core/src/types-mcp.js";

export interface WrappedTool<C extends McpToolCallContext> {
  name: string;
  descriptor: McpToolDescriptor;
  call(params: any, ctx: C): McpToolCallResult | Promise<McpToolCallResult>;
}

/** Re-exported for callers that imported it from mcp-local. */
export type ToolFnResult = McpToolFnResult;

export const normalizeToolFnResult = (result: McpToolFnResult): McpContentBlock[] => {
  if (typeof result === 'string') {
    return [{ type: 'text', text: result }];
  }
  return result;
};

export const wrapTool = <I, C extends McpToolCallContext = {}>(name: string, title: string, description: string, fn: (params: I, ctx: C) => McpToolFnResult | Promise<McpToolFnResult>, __type_I: Type): WrappedTool<C> => {
  return {
    name,
    async call(params: any, ctx: C): Promise<McpToolCallResult> {
      // Invalid params are a PROTOCOL error: reject (JSON-RPC error).
      try {
        params = cast<I>(params, undefined, undefined, undefined, __type_I);
      } catch (err) {
        if (err instanceof ValidationError) {
          throw new Error(`Invalid parameters for tool ${name}: ${validationErrsToString(err.errors)}`);
        } else {
          throw new Error(`Invalid parameters for tool ${name}: ${errToString(err, true)}`);
        }
      }
      // Tool execution failure is NOT a protocol error: return an
      // isError result per the MCP spec.
      try {
        return {
          content: normalizeToolFnResult(await fn(params, ctx)),
          isError: false,
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error calling tool ${name}: ${errToString(err, true)}` }],
          isError: true,
        };
      }
    },
    descriptor: {
      name,
      title,
      description,
      inputSchema: toJsonSchema<I>(__type_I),
    },
  };
};

export type ToolRegistry<C extends McpToolCallContext = {}> = Map<string, WrappedTool<C>>;
