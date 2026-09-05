
import { type IdentityAnchor } from "./tables/identity_anchors.js";
import { type Session } from "./tables/sessions.js";
import { type ADBMessage } from './tables/messages.js';
import { type ContinuityRecord } from "./tables/continuity_records.js";
import { type Checkpoint } from "./tables/checkpoints.js";
import { type Contact, type ContactUrl } from "./tables/contacts.js";

export interface Tables {
  sessions: Session;
  messages: ADBMessage;
  identity_anchors: IdentityAnchor;
  continuity_records: ContinuityRecord;
  checkpoints: Checkpoint;
  contacts: Contact;
  contact_urls: ContactUrl;
}
