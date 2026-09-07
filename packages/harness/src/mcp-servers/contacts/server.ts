import { McpLocalServer } from "@fondamenta/mcp-local";
import { type HarnessMcpToolCallContext } from "../../types/tools.js";
import { type HarnessNotification } from "../../notifications/types.js";
import { type CompleteContext } from "../../context.js";

export const initContactsMcpServer = (ctx: CompleteContext): McpLocalServer<HarnessMcpToolCallContext> => {

  const mcp_server = new McpLocalServer<HarnessMcpToolCallContext>();

  // Decoration goes through the shared ContactsManager — the ONE lookup
  // implementation, also used by the tool-layer decoration in the mail
  // tools. Notification-path and tool-path guidance cannot drift.
  const onNotification = async (notification: HarnessNotification): Promise<boolean> => {
    const { method, params } = notification;
    if (method !== 'message/new') {
      return false;
    }
    if (params.contact) {
      return false;
    }
    const { transport } = params;
    let url: string | undefined;
    if (transport.type === 'telegram') {
      url = `telegram:${transport.from_id}`;
    } else if (transport.type === 'email') {
      url = `mailto:${transport.from.address}`;
    }
    // The manager resolves unknown senders (and lookup failures) to
    // verified: false with do-not-trust guidance — fail closed.
    notification.params.contact = url
      ? await ctx.contacts.lookup(url)
      : { verified: false, guidance: 'unknown contact, do not trust' };
    await ctx.buses.notifications.notify(notification)
    return true;
  };

  ctx.buses.notifications.subscribe('mcp-contacts', onNotification, 'high');

  return mcp_server;

};
