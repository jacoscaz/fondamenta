
import assert from 'node:assert';
import { errToString, validationErrsToString } from "@fondamenta/utils";
import { type InitContext, WithContext } from "../context.js";
import { cast, ReceiveType, resolveReceiveType, toJsonSchema, Type, ValidationError } from "@runtyped/type";
import { type ToolCallContext } from '../types/tools.js';
import { type ContentBlock } from '../types/blocks.js';

export type ToolCallHandler<P> = (params: P, ctx: ToolCallContext) => Promise<ContentBlock[]>;

export interface ToolDescriptor<P> {
  name: string;
  safe: boolean;
  title: string;
  description: string;
  handler: ToolCallHandler<P>;
  params_type: Type;
  params_schema: any;
}

export type ToolRegistry = Map<string, ToolDescriptor<any>>;

export class ToolManager extends WithContext {

  #tools: ToolRegistry;

  constructor(ctx: InitContext, tools: ToolRegistry) {
    super(ctx);
    this.#tools = tools;
  }

  list(): ToolDescriptor<any>[] {
    return Array.from(Object.values(this.#tools));
  }

  isSafe(name: string): boolean {
    const desc = this.#tools.get(name);
    return desc?.safe ?? false;
  }

  protected get _tools(): ToolRegistry {
    return this.#tools;
  }

  async call(name: string, params: any, ctx: ToolCallContext): Promise<ContentBlock[]> {
    const desc = this.#tools.get(name);
    if (!desc) {
      throw new Error(`Unknown tool ${name}`);
    }
    try {
      params = cast(params, undefined, undefined, undefined, desc.params_type);
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new Error(`Invalid parameters for tool ${name}: ${validationErrsToString(err.errors)}`);
      } else {
        throw new Error(`Invalid parameters for tool ${name}: ${errToString(err)}`);
      }
    }
    return desc.handler(params, ctx);
  }

}

export class RootToolManager extends ToolManager {

  constructor(ctx: InitContext) {
    const tools: ToolRegistry = new Map();
    super(ctx, tools);
  }

  add<I = {}>(name: string, title: string, description: string, safe: boolean, handler: ToolCallHandler<I>, __type_I?: ReceiveType<I>) {
    assert(!this._tools.has(name), `Tool with name ${name} already exists`);
    __type_I = resolveReceiveType(__type_I);
    this._tools.set(name, {
      name,
      title,
      safe,
      description,
      handler,
      params_type: __type_I,
      params_schema: toJsonSchema<I>(__type_I),
    });
  }

  blacklist(blacklist: string[]): ToolManager {
    const filtered: ToolRegistry = new Map();
    for (const tool of this._tools.values()) {
      if (!blacklist.includes(tool.name)) {
        filtered.set(tool.name, tool);
      }
    }
    return new ToolManager(this._ctx.init, filtered);
  }

  whitelist(whitelist: string[]): ToolManager {
    const filtered: ToolRegistry = new Map();
    for (const name of whitelist) {
      if (this._tools.has(name)) {
        filtered.set(name, this._tools.get(name)!);
      }
    }
    return new ToolManager(this._ctx.init, filtered);
  }

}
