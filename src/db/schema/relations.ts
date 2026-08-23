import { relations } from "drizzle-orm";

import { auditLog } from "@/db/schema/audit";
import { customers } from "@/db/schema/customers";
import { categories, products } from "@/db/schema/inventory";
import { invoices } from "@/db/schema/invoices";
import { ledgerEntries } from "@/db/schema/ledger";
import { orderLineItems, orders } from "@/db/schema/orders";
import { stockMovements } from "@/db/schema/stock-movements";
import { roles, userRoles, users } from "@/db/schema/users";

export const usersRelations = relations(users, ({ many }) => ({
  assignedRoles: many(userRoles),
  auditEvents: many(auditLog),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  members: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
    relationName: "user_roles_user",
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  orderLines: many(orderLineItems),
  stockMovements: many(stockMovements),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  lineItems: many(orderLineItems),
  invoice: one(invoices),
  stockMovements: many(stockMovements),
  ledgerEntries: many(ledgerEntries),
}));

export const orderLineItemsRelations = relations(orderLineItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderLineItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderLineItems.productId],
    references: [products.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  order: one(orders, {
    fields: [invoices.orderId],
    references: [orders.id],
  }),
  ledgerEntries: many(ledgerEntries),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  product: one(products, {
    fields: [stockMovements.productId],
    references: [products.id],
  }),
  order: one(orders, {
    fields: [stockMovements.orderId],
    references: [orders.id],
  }),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  order: one(orders, {
    fields: [ledgerEntries.orderId],
    references: [orders.id],
  }),
  invoice: one(invoices, {
    fields: [ledgerEntries.invoiceId],
    references: [invoices.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  actor: one(users, {
    fields: [auditLog.actorUserId],
    references: [users.id],
    relationName: "audit_log_actor",
  }),
}));
