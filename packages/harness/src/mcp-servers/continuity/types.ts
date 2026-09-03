
import { McpNotification } from "@fondamenta/mcp-core";

export interface DueTodoNotification extends McpNotification {
  method: 'todo/due';
  params: {
    text: string;
  };
};
