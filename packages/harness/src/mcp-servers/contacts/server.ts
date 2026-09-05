
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
    if (notification.method === 'message/new') {
      if ('contact' in notification.params) {
        return false;
      }
      notification.params.contact = null;
      if (notification.params.transport.type === 'telegram') {
        await enrichWithContact(notification, `telegram:${notification.params.transport.chat_id}`);
      } else if (notification.params.transport.type === 'email') {
        await enrichWithContact(notification, `mailto:${notification.params.transport.from}`);
      }
    }
    await ctx.buses.notifications.notify(notification)
    return true;
  };

  ctx.buses.notifications.subscribe('mcp-contacts', onNotification, 'high');

  return mcp_server;

};
