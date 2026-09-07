
import { type Contact } from "./contacts.js";
import { type UserBlock, type BaseMessage } from "./messages.js";

export interface UserMessageIncomingNotification extends BaseMessage {
  role: 'user';
  type: 'notification';
  method: 'message/incoming';
  blocks: UserBlock[];
  contact?: Contact;
}

export type UserNotification =
  | UserMessageIncomingNotification
  ;
