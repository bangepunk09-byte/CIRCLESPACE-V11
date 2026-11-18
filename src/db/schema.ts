import { relations } from 'drizzle-orm';
import { integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  userId: text('user_id').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('employee'),
  department: text('department').default('Marketing'),
  jobTitle: text('job_title').default('Staff Member'),
  status: text('status').notNull().default('active'),
  avatar: text('avatar'),
  profileData: jsonb('profile_data').$type<Record<string, any>>().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  numberStr: text('number_str'),
  title: text('title').notNull(),
  status: text('status').notNull().default('todo'),
  priority: text('priority').default('medium'),
  boardId: text('board_id'),
  projectId: text('project_id'),
  assigneeId: text('assignee_id'),
  reporterId: text('reporter_id'),
  data: jsonb('data').$type<Record<string, any>>().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  type: text('type').notNull().default('dm'),
  name: text('name'),
  data: jsonb('data').$type<Record<string, any>>().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  senderId: text('sender_id').notNull(),
  text: text('text'),
  type: text('type').default('text'),
  data: jsonb('data').$type<Record<string, any>>().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  authorId: text('author_id'),
  parentId: text('parent_id'),
  content: text('content'),
  data: jsonb('data').$type<Record<string, any>>().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const circleNotes = pgTable('circle_notes', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  title: text('title'),
  data: jsonb('data').$type<Record<string, any>>().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const workspaceState = pgTable('workspace_state', {
  key: text('key').primaryKey(),
  revision: integer('revision').notNull().default(0),
  data: jsonb('data').$type<Record<string, any>>().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const uploadedFiles = pgTable('uploaded_files', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  originalName: text('original_name'),
  mimetype: text('mimetype').notNull().default('application/octet-stream'),
  sizeBytes: integer('size_bytes').notNull().default(0),
  contentBase64: text('content_base64').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const workspaceSnapshots = pgTable('workspace_snapshots', {
  id: serial('id').primaryKey(),
  snapshotId: text('snapshot_id').notNull().unique(),
  label: text('label').notNull(),
  source: text('source').notNull().default('auto'),
  revision: integer('revision').notNull().default(0),
  summary: jsonb('summary').$type<Record<string, any>>().notNull(),
  payload: jsonb('payload').$type<Record<string, any>>().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  assignedTasks: many(tasks),
  posts: many(posts),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  assignee: one(users, {
    fields: [tasks.assigneeId],
    references: [users.userId],
  }),
}));

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.userId],
  }),
}));
