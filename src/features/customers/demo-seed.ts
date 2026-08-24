import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { customers } from "@/db/schema";
import { createCustomer } from "@/features/customers/service";

/**
 * Demo customer directory.
 *
 * Definitions are fixed so repeated runs are no-ops: existence is checked by
 * the lowercased email before delegating to the production service, which
 * supplies validation, audit events, and the `customer.created` trail.
 */

interface DemoCustomer {
  name: string;
  email: string;
  companyName?: string;
  phone?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region?: string;
  postalCode: string;
  countryCode: string;
  notes?: string;
}

const DEMO_CUSTOMERS: DemoCustomer[] = [
  {
    name: "Acme Retail Group",
    email: "buying@acmeretail.example",
    companyName: "Acme Retail Group Inc.",
    phone: "+1 555-0100",
    addressLine1: "100 Commerce Way",
    city: "Springfield",
    region: "IL",
    postalCode: "62704",
    countryCode: "US",
    notes: "Net-30 terms. Consolidates weekly orders.",
  },
  {
    name: "Bright Hardware Co-op",
    email: "orders@brighthardware.example",
    phone: "+1 555-0101",
    addressLine1: "42 Mill Lane",
    addressLine2: "Dock B",
    city: "Portland",
    region: "OR",
    postalCode: "97201",
    countryCode: "US",
  },
  {
    name: "Cedar & Sons Contractors",
    email: "ap@cedarsons.example",
    companyName: "Cedar & Sons LLC",
    addressLine1: "7 Forest Road",
    city: "Denver",
    region: "CO",
    postalCode: "80202",
    countryCode: "US",
    notes: "Site deliveries require 24h notice.",
  },
  {
    name: "Delta Facilities Management",
    email: "procurement@deltafm.example",
    companyName: "Delta FM Ltd.",
    phone: "+44 20 7946 0958",
    addressLine1: "12 Kingsway",
    city: "London",
    postalCode: "WC2B 6AN",
    countryCode: "GB",
  },
  {
    name: "Everett Garden Supply",
    email: "hello@everettgarden.example",
    addressLine1: "301 Orchard Ave",
    city: "Salem",
    region: "OR",
    postalCode: "97301",
    countryCode: "US",
    notes: "Seasonal volume peaks in spring.",
  },
];

export interface DemoCustomersResult {
  created: number;
}

/** Idempotently seeds demo customers through the production service. */
export async function seedDemoCustomers(
  actorId: string,
): Promise<DemoCustomersResult> {
  const db = getDb();

  let created = 0;

  for (const definition of DEMO_CUSTOMERS) {
    const email = definition.email.toLowerCase();

    const existingRows = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, email))
      .limit(1);

    if (existingRows.length > 0) {
      continue;
    }

    await createCustomer(
      {
        name: definition.name,
        email,
        phone: definition.phone,
        companyName: definition.companyName,
        addressLine1: definition.addressLine1,
        addressLine2: definition.addressLine2,
        city: definition.city,
        region: definition.region,
        postalCode: definition.postalCode,
        countryCode: definition.countryCode,
        notes: definition.notes,
      },
      actorId,
      crypto.randomUUID(),
    );

    created += 1;
  }

  return { created };
}
