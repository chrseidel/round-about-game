import type { SQSBatchResponse, SQSHandler, SQSRecord } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { documentClient } from "../shared/db.ts";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  decideTimeout,
  reconcile,
  type TimeoutMessage,
} from "../../../shared/deadlines.ts";
import type { Session } from "../../../shared/protocol.ts";

export type TimeoutDeps = {
  load(squid: string): Promise<Session | null>;
  /** Resolves false when another write changed the session first. */
  save(next: Session, expectedVersion: number): Promise<boolean>;
  resend(message: TimeoutMessage, delaySeconds: number): Promise<void>;
};

async function handleOne(
  message: TimeoutMessage,
  deps: TimeoutDeps,
  now: () => number,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const session = await deps.load(message.squid);
    const decision = decideTimeout(message, session, now());
    if (decision.action === "ignore") return;
    if (decision.action === "retry")
      return deps.resend(message, decision.delaySeconds);
    if (await deps.save(reconcile(session!, now()), session!.version)) return;
  }
  throw new Error("Session kept changing");
}

/** Applies due timeouts; stale, duplicate and old-turn messages are ignored. */
export async function handleTimeouts(
  records: SQSRecord[],
  deps: TimeoutDeps,
  now: () => number,
): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of records) {
    try {
      await handleOne(JSON.parse(record.body) as TimeoutMessage, deps, now);
    } catch (error) {
      console.error("Timeout processing failed", (error as Error).name);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

const db = documentClient();
const sqs = new SQSClient({});
const table = process.env.SESSION_TABLE;

const deps: TimeoutDeps = {
  async load(squid) {
    const result = await db.send(
      new GetCommand({
        TableName: table,
        Key: { squid },
        ConsistentRead: true,
      }),
    );
    return (result.Item as Session | undefined) ?? null;
  },
  async save(next, expectedVersion) {
    try {
      await db.send(
        new PutCommand({
          TableName: table,
          Item: next,
          ConditionExpression: "#version = :version",
          ExpressionAttributeNames: { "#version": "version" },
          ExpressionAttributeValues: { ":version": expectedVersion },
        }),
      );
      return true;
    } catch (error) {
      if ((error as Error).name === "ConditionalCheckFailedException")
        return false;
      throw error;
    }
  },
  async resend(message, delaySeconds) {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.TIMEOUT_QUEUE_URL,
        MessageBody: JSON.stringify(message),
        DelaySeconds: delaySeconds,
      }),
    );
  },
};

export const handler: SQSHandler = (event) =>
  handleTimeouts(event.Records, deps, Date.now);
