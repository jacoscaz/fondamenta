import {
  cast,
  Type,
  ValidationError,
  toJsonSchema,
} from '@runtyped/type';

import {
  type McpToolCallResult,
  type McpToolDescriptor,
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

export const wrapTool = <I, C extends McpToolCallContext = {}>(name: string, title: string, description: string, fn: (params: I, ctx: C) => McpToolCallResult | Promise<McpToolCallResult>, __type_I: Type): WrappedTool<C> => {
  return {
    name,
    async call(params: any, ctx: C) {
      try {
        params = cast<I>(params, undefined, undefined, undefined, __type_I);
      } catch (err) {
        if (err instanceof ValidationError) {
          throw new Error(`Invalid parameters for tool ${name}: ${validationErrsToString(err.errors)}`);
        } else {
          throw new Error(`Invalid parameters for tool ${name}: ${errToString(err, true)}`);
        }
      }
      try {
        return await fn(params, ctx);
      } catch (err) {
        throw new Error(`Error calling tool ${name}: ${errToString(err, true)}`);
      }
    },
    descriptor: {
      name,
      title,
      description,
      input_schema: toJsonSchema<I>(__type_I),
    },
  };
};

export type ToolRegistry<C extends McpToolCallContext = {}> = Map<string, WrappedTool<C>>;
