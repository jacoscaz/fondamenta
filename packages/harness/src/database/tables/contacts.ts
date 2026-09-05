
import {
  sql,
  type GeneratedAlways,
  type Insertable,
  type Selectable,
  type Updateable,
} from "kysely";

import type { DB } from "../client.js";

export interface Contact {
  id: GeneratedAlways<number>;
  name: string;
  guidance: string;
  created_at: Date;
  updated_at: Date;
}

export interface ContactUrl {
  id: GeneratedAlways<number>;
  contact_id: number;
  url: string;
  guidance: string;
  created_at: Date;
  updated_at: Date;
}

export type InsertableContact = Insertable<Contact>;
export type UpdateableContact = Updateable<Contact>;
export type SelectableContact = Selectable<Contact>;

export interface SelectContactsOpts {
  id?: number;
  url?: string;
}

const initSelectContactsQuery = (db: DB, opts: SelectContactsOpts) => {
  let query = db.selectFrom('contacts').selectAll();
  if (opts.url) {
    query = query.where('id', 'in',
      qb => qb.selectFrom('contact_urls')
        .select('contact_id')
        .where('url', '=', opts.url!)
    );
  }
  return db.selectFrom('contacts').selectAll();
}

export const selectContact = async (db: DB, opts: SelectContactsOpts) => {
  let query = initSelectContactsQuery(db, opts);
  query = query.limit(1);
  return await query.executeTakeFirst();
};

export const selectContacts = async (db: DB, opts: SelectContactsOpts) => {
  let query = initSelectContactsQuery(db, opts);
  return await query.execute();
};

export const selectContactByUrl = async (db: DB, url: string): Promise<SelectableContact | undefined> => {
  let query = db.selectFrom('contacts as c')
    .innerJoin('contact_urls as cu', 'c.id', 'cu.contact_id')
    .where('cu.url', '=', url)
    .selectAll('c')
    .select(eb => sql<string>`concat(${eb.ref('c.guidance')}, ' ', ${eb.ref('cu.guidance')})`.as('guidance'));
  return await query.executeTakeFirst();
};
