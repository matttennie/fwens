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
  const filter: MessageFilter = {
    channel: args.channel,
    since: args.since,
    limit: args.limit,
  };
  return readMessages(db, filter);
}
