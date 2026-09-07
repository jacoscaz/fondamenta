// Identity anchor tools — ported from the MCP server (2026-09-07
// overnight handoff). Semantics unchanged: anchors are the foundational
// identity layer; readonly entries are immutable by design.

import { type InsertableIdentityAnchor, type SelectableIdentityAnchor, type IdentityAnchorFilters } from "../../database/tables/identity_anchors.js";
import { deleteIdentityAnchor, insertIdentityAnchor, selectIdentityAnchors, updateIdentityAnchor } from "../../database/tables/identity_anchors.js";
import { type CompleteContext } from "../../context.js";
import { type TextBlock } from "../../types/blocks.js";

/**
 * Filter parameters for identity anchors. Dates are ISO 8601 strings for JSON transport.
 * Identity anchors don't support tags — they're always loaded in full for the system prompt.
 */
interface IdentityAnchorQueryFilters {
  id?: number | number[];
  from?: string;
  to?: string;
  offset?: number;
  limit?: number;
}

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

const toIdentityAnchorFilters = (args: IdentityAnchorQueryFilters): IdentityAnchorFilters => {
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

const text = (s: string): TextBlock[] => [{ type: 'text', text: s }];

export const initAnchorsTools = (ctx: CompleteContext) => {

  ctx.managers.tools.add<IdentityAnchorInsertParams>(
    'anchors_insert',
    'Identity Anchors - Insert',
    'Adds a new identity anchor to your foundational context.',
    true,
    async (args, call_ctx) => {
      const entry: InsertableIdentityAnchor = {
        data: args.data,
        created_at: new Date(),
        priority: args.priority,
        readonly: args.readonly,
      };
      await insertIdentityAnchor(call_ctx.db, entry);
      return text('identity anchor inserted correctly');
    },
  );

  ctx.managers.tools.add<IdentityAnchorQueryFilters>(
    'anchors_select',
    'Identity Anchors - Select',
    'Queries existing identity anchors',
    true,
    async (args, call_ctx) => {
      const entries = await selectIdentityAnchors(call_ctx.db, toIdentityAnchorFilters(args));
      return text(serializeIdentityAnchors(entries));
    },
  );

  ctx.managers.tools.add<IdentityAnchorDeleteParams>(
    'anchors_delete',
    'Identity Anchors - Delete',
    'Deletes an existing identity anchor',
    true,
    async (args, call_ctx) => {
      await deleteIdentityAnchor(call_ctx.db, args.entry_id);
      return text('identity anchor deleted correctly');
    },
  );

  ctx.managers.tools.add<IdentityAnchorUpdateParams>(
    'anchors_update',
    'Identity Anchors - Update',
    'Updates an existing identity anchor (data, priority, or readonly status). Can only update mutable entries.',
    true,
    async (args, call_ctx) => {
      const updates: { data?: string; priority?: number; readonly?: boolean; } = {};
      if (args.data !== undefined) updates.data = args.data;
      if (args.priority !== undefined) updates.priority = args.priority;
      if (args.readonly !== undefined) updates.readonly = args.readonly;

      await updateIdentityAnchor(call_ctx.db, args.entry_id, updates);
      return text('identity anchor updated correctly');
    },
  );

};
