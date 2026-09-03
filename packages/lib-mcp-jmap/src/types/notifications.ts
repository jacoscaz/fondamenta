
import { McpNotification } from "@fondamenta/mcp-core";

export interface JMAPNewEmailNotification extends McpNotification {
  method: 'jmap/new_email',
  params: {
    text: string;
  };
};

export type JMAPNotification =
  | JMAPNewEmailNotification
  ;
