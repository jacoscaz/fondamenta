import { type IdentityAnchor } from "./tables/identity_anchors.js";
import { type Session } from "./tables/sessions.js";
import { type ADBMessage } from './tables/messages.js';
import { type ContinuityRecord } from "./tables/continuity_records.js";
import { type Checkpoint } from "./tables/checkpoints.js";

export interface Tables {
  sessions: Session;
  messages: ADBMessage;
  identity_anchors: IdentityAnchor;
  continuity_records: ContinuityRecord;
  checkpoints: Checkpoint;
}
