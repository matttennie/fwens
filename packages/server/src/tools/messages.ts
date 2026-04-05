import type Database from "better-sqlite3";
import {
  type Message,
  type MessageFilter,
  type PostMessageInput,
  postMessage,
  readMessages,
} from "../db.js";
import { validateStringLength } from "../validation.js";

export function handlePostMessage(
  db: Database.Database,
  sessionId: string,
  args: { channel?: string; content: string },
): { message_id: string } {
  validateStringLength(args.content, 10_000, "content");
  if (args.channel !== undefined) {
    validateStringLength(args.channel, 200, "channel");
  }
  const input: PostMessageInput = {
    channel: args.channel,
    content: args.content,
  };
  const messageId = postMessage(db, sessionId, input);
  return { message_id: messageId };
}

export function handleReadMessages(
  db: Database.Database,
  args: { channel?: string; since?: string; limit?: number },
): Message[] {
  if (args.channel !== undefined) {
    validateStringLength(args.channel, 200, "channel");
  }
  if (args.since && !/^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}:\d{2}/.test(args.since)) {
    throw new Error('Invalid since format. Use ISO 8601 datetime (e.g., "2026-01-01T00:00:00")');
  }
  const clampedLimit = args.limit !== undefined ? Math.min(args.limit, 1000) : undefined;
  return readMessages(db, {
    channel: args.channel,
    since: args.since,
    limit: clampedLimit,
  });
}
