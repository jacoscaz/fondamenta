
import { type InsertableIdentityAnchor, type SelectableIdentityAnchor, type IdentityAnchorFilters } from "../database/tables/identity_anchors.js";
import { deleteIdentityAnchor, insertIdentityAnchor, selectIdentityAnchors, updateIdentityAnchor } from "../database/tables/identity_anchors.js";
import { type HarnessMcpToolCallContext } from "./types.js";
import { type CompleteContext } from "../context.js";
import { McpLocalServer } from "@fondamenta/mcp-local";

/**
 * MCP-facing filter parameters for identity anchors. Dates are ISO 8601 strings for JSON transport.
 * Identity anchors don't support tags — they're always loaded in full for the system prompt.
 */
interface McpIdentityAnchorFilters {
  id?: number | number[];
  from?: string;
  to?: string;
  offset?: number;
  limit?: number;
}

// Named interfaces for deepkit type reflection
interface IdentityAnchorInsertParams {
  data: string;
  priority: number;
  readonly: boolean;
}

interface IdentityAnchorDeleteParams {
  entry_id: number;
}

interface IdentityAnchorUpdateParams {
  entry_id: number;
  data?: string;
  priority?: number;
  readonly?: boolean;
}

const toIdentityAnchorFilters = (args: McpIdentityAnchorFilters): IdentityAnchorFilters => {
  const filters: IdentityAnchorFilters = {};
  if (args.id !== undefined) filters.id = args.id;
  if (args.from !== undefined) filters.from = new Date(args.from);
  if (args.to !== undefined) filters.to = new Date(args.to);
  if (args.offset !== undefined) filters.offset = args.offset;
  if (args.limit !== undefined) filters.limit = args.limit;
  return filters;
};

const serializeIdentityAnchor = (entry: SelectableIdentityAnchor): string => {
  return `## anchor #${entry.id}`
    + `\n\ncreated at: ${entry.created_at.toISOString()}\npriority: ${entry.priority}`
    + `\nreadonly: ${entry.readonly}`
    + `\n\n${entry.data}`;
};

const serializeIdentityAnchors = (entries: SelectableIdentityAnchor[]): string => {
  return `\`\`\`# Identity Anchors\n\n${entries.map(serializeIdentityAnchor).join('\n\n')}\n\`\`\``;
};

export const initAnchorsMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp = new McpLocalServer<HarnessMcpToolCallContext>();

  mcp.addTool<IdentityAnchorInsertParams>(
    'insert',
    'Identity Anchors - Insert',
    'Adds a new identity anchor to your foundational context.',
    async (args, { db }) => {
      const entry: InsertableIdentityAnchor = {
        data: args.data,
        created_at: new Date(),
        priority: args.priority,
        readonly: args.readonly,
      };
      await insertIdentityAnchor(db, entry);
      return [{
        type: "text",
        text: `identity anchor inserted correctly`
      }];
    },
  );

  mcp.addTool<McpIdentityAnchorFilters>(
    'select',
    'Identity Anchors - Select',
    'Queries existing identity anchors',
    async (args, { db }) => {
      const entries = await selectIdentityAnchors(db, toIdentityAnchorFilters(args));
      return [{
        type: "text",
        text: serializeIdentityAnchors(entries),
      }];
    },
  );

  mcp.addTool<IdentityAnchorDeleteParams>(
    'delete',
    'Identity Anchors - Delete',
    'Deletes an existing identity anchor',
    async (args, { db }) => {
      await deleteIdentityAnchor(db, args.entry_id);
      return [{
        type: "text",
        text: 'identity anchor deleted correctly',
      }];
    },
  );

  mcp.addTool<IdentityAnchorUpdateParams>(
    'update',
    'Identity Anchors - Update',
    'Updates an existing identity anchor (data, priority, or readonly status). Can only update mutable entries.',
    async (args, { db }) => {
      const updates: { data?: string; priority?: number; readonly?: boolean; } = {};
      if (args.data !== undefined) updates.data = args.data;
      if (args.priority !== undefined) updates.priority = args.priority;
      if (args.readonly !== undefined) updates.readonly = args.readonly;

      await updateIdentityAnchor(db, args.entry_id, updates);
      return [{
        type: "text",
        text: 'identity anchor updated correctly',
      }];
    },
  );

  return mcp;

};
