
import { McpLocalServer } from "@fondamenta/mcp-local";
import { type HarnessMcpToolCallContext } from "../../types/tools.js";
import { type CompleteContext } from "../../context.js";
import { type HarnessNotification } from "../../notifications/types.js";
import { selectContactByUrl } from "../../database/tables/contacts.js";
import { type McpNewMessageNotification } from "@fondamenta/mcp-core";

export const initContactsMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp_server = new McpLocalServer<HarnessMcpToolCallContext>();

  const enrichWithContact = async (notification: McpNewMessageNotification, contact_url: string) => {
    const contact = await selectContactByUrl(ctx.db, contact_url);
    if (contact) {
      notification.params.contact = {
        id: contact.id,
        name: contact.name,
        guidance: contact.guidance,
      };
    }
  };

  const onNotification = async (notification: HarnessNotification): Promise<boolean> => {
    const { method, params } = notification;
    if (method !== 'message/new') {
      return false;
    }
    // Skip-if-already-processed check. NOTE: this MUST be value-based, not
    // presence-based ('contact' in params): the mcp-manager routing cast()
    // rebuilds notification params per the declared type, adding optional
    // keys (contact, transcription) with `undefined` values. A presence
    // check therefore fires on FIRST pass and enrichment never runs.
    // undefined  = never seen  -> enrich
    // null       = claimed, lookup failed or in progress -> skip
    // populated  = already enriched -> skip
    if (params.contact !== undefined) {
      return false;
    }
    notification.params.contact = null;
    const { transport } = params;
    if (transport.type === 'telegram') {
      await enrichWithContact(notification, `telegram:${transport.from_id}`);
    } else if (transport.type === 'email') {
      await enrichWithContact(notification, `mailto:${transport.from}`);
    }
    await ctx.buses.notifications.notify(notification)
    return true;
  };

  ctx.buses.notifications.subscribe('mcp-contacts', onNotification, 'high');

  return mcp_server;

};
