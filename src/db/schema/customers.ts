import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { timestamps } from "@/db/schema/shared";
import { users } from "@/db/schema/users";

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    phone: varchar("phone", { length: 40 }),
    companyName: varchar("company_name", { length: 160 }),
    addressLine1: varchar("address_line_1", { length: 160 }).notNull(),
    addressLine2: varchar("address_line_2", { length: 160 }),
    city: varchar("city", { length: 100 }).notNull(),
    region: varchar("region", { length: 100 }),
    postalCode: varchar("postal_code", { length: 24 }).notNull(),
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    notes: text("notes"),
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("customers_email_lower_unique").on(sql`lower(${table.email})`),
    index("customers_name_idx").on(table.name),
    index("customers_active_idx").on(table.isActive),
  ],
);
