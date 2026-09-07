
import {
  type Contact,
} from "./contacts.js";

import {
  type UserBlock,
  type BaseMessage,
} from "./messages.js";

export interface BaseUserNotification extends BaseMessage {
  role: 'user';
  type: 'notification';
  method: string;
  blocks: UserBlock[];
  contact?: Contact;
}

export interface UserMessageIncomingNotification extends BaseUserNotification {
  method: 'message/incoming';
  transport:
    | { type: 'telegram'; from_id: number; chat_id: number; username?: string; }
    | { type: 'email', from: { address: string; name?: string; } }
    ;
}

export interface UserTodoDueNotification extends BaseUserNotification {
  method: 'todo/due';
}

export type UserNotification =
  | UserMessageIncomingNotification
  | UserTodoDueNotification
  ;
