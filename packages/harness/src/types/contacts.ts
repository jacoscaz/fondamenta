
export interface VerifiedContact {
  verified: true;
  id: number;
  name: string;
  guidance: string;
}

export interface UnverifiedContact {
  verified: false;
  guidance: string;
}

/**
 * Standing of a sender, resolved against the contacts store. This is the
 * shape carried by message/new notifications' `contact` field and by the
 * tool-layer decoration (mail read/inbox): one semantics everywhere.
 *
 * `verified: false` is the resting state — absence from the contacts
 * store is not neutrality, it is absence of standing (rejection posture).
 */
export type Contact = VerifiedContact | UnverifiedContact;
