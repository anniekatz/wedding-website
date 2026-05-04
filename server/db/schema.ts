import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const households = sqliteTable('households', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  inviteCode: text('invite_code').notNull().unique(),
  name: text('name').notNull(),
  allowPlusOne: integer('allow_plus_one', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  reminderEmail: text('reminder_email'),
});

export const guests = sqliteTable('guests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id').notNull().references(() => households.id),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  nickname: text('nickname'),
  email: text('email'),
  type: text('type', { enum: ['adult', 'child'] }).notNull().default('adult'),
  attending: integer('attending', { mode: 'boolean' }),
  comments: text('comments'),
  entreeChoice: text('entree_choice'),
});

export const plusOnes = sqliteTable('plus_ones', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id').notNull().references(() => households.id).unique(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  attending: integer('attending', { mode: 'boolean' }).notNull().default(true),
  comments: text('comments'),
  entreeChoice: text('entree_choice'),
});

export const scheduleEvents = sqliteTable('schedule_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  time: text('time').notNull(),
  endTime: text('end_time'),
  location: text('location').notNull(),
  description: text('description'),
  order: integer('order').notNull().default(0),
});

export const entreeOptions = sqliteTable('entree_options', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  value: text('value').notNull().unique(),
  label: text('label').notNull(),
  availableFor: text('available_for', { enum: ['adult', 'child', 'both'] }).notNull().default('both'),
  order: integer('order').notNull().default(0),
});

export const faqs = sqliteTable('faqs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  order: integer('order').notNull().default(0),
});

export const rsvpLogs = sqliteTable('rsvp_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id').notNull().references(() => households.id),
  action: text('action', { enum: ['initial_rsvp', 'modification'] }).notNull(),
  timestamp: text('timestamp').notNull(),
  snapshot: text('snapshot').notNull(),
});

export const adminUsers = sqliteTable('admin_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const adminSessions = sqliteTable('admin_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: integer('user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
});

export type Household = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;
export type Guest = typeof guests.$inferSelect;
export type NewGuest = typeof guests.$inferInsert;
export type PlusOne = typeof plusOnes.$inferSelect;
export type NewPlusOne = typeof plusOnes.$inferInsert;
export type ScheduleEvent = typeof scheduleEvents.$inferSelect;
export type NewScheduleEvent = typeof scheduleEvents.$inferInsert;
export type RsvpLog = typeof rsvpLogs.$inferSelect;
export type NewRsvpLog = typeof rsvpLogs.$inferInsert;
export type EntreeOption = typeof entreeOptions.$inferSelect;
export type NewEntreeOption = typeof entreeOptions.$inferInsert;
export type Faq = typeof faqs.$inferSelect;
export type NewFaq = typeof faqs.$inferInsert;
export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
export type AdminSession = typeof adminSessions.$inferSelect;
export type NewAdminSession = typeof adminSessions.$inferInsert;
