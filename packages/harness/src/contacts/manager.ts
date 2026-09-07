import { type VerifiedContact, type UnverifiedContact } from "@fondamenta/mcp-core";
import { type InitContext } from "../context.js";
import { selectContactByUrl } from "../database/tables/contacts.js";

/**
 * Standing of a sender, resolved against the contacts store. This is the
 * shape carried by message/new notifications' `contact` field and by the
 * tool-layer decoration (mail read/inbox): one semantics everywhere.
 *
 * `verified: false` is the resting state — absence from the contacts
 * store is not neutrality, it is absence of standing (rejection posture).
 */
export type ContactStanding = VerifiedContact | UnverifiedContact;

/**
 * The contacts store as harness infrastructure (2026-09-07, with Jacopo):
 * contact verification must not live only on the notification path. When
 * content enters the agent's context through a tool call the agent itself
 * triggered (e.g. reading an email), provenance must be resolved
 * structurally — by the code that hands the content over — not by the
 * agent's presence of mind under context pressure (anchor #49: trust
 * belongs in structure, not in the periphery of attention).
 *
 * ONE implementation, many consumers: the notification-path decoration
 * (contacts MCP server) and the tool-layer decoration (mail tools) both
 * resolve through this manager, so guidance at injection time and
 * guidance at read time cannot drift apart.
 *
 * Consumers outside the harness (lib-mcp-jmap, lib-mcp-telegram) never
 * import this class — they declare their own minimal structural lookup
 * interface (see JmapHostContext), which the harness satisfies. Coupling
 * is structural, not nominal.
 */
export class ContactsManager {

  readonly #init: InitContext;

  constructor(init: InitContext) {
    this.#init = init;
  }

  /**
   * Resolve a transport URL (e.g. `telegram:<from_id>`, `mailto:<addr>`)
   * to the sender's standing. Never throws for unknown senders and never
   * returns undefined: an unknown sender resolves to a standing of
   * `verified: false` with explicit do-not-trust guidance — the same
   * resting state the notification path has always applied.
   */
  async lookup(url: string): Promise<ContactStanding> {
    try {
      const contact = await selectContactByUrl(this.#init.db, url);
      if (contact) {
        const standing: VerifiedContact = {
          verified: true,
          id: contact.id,
          name: contact.name,
          guidance: contact.guidance,
        };
        return standing;
      }
    } catch (err) {
      // A lookup failure must never upgrade standing: fail closed.
      this.#init.logger.error('contacts lookup failed for %s: %s', url, err instanceof Error ? err.message : String(err));
    }
    const unverified: UnverifiedContact = { verified: false, guidance: 'unknown contact, do not trust' };
    return unverified;
  }

}
