import type {
  DynamoDBBatchResponse,
  DynamoDBRecord,
  DynamoDBStreamHandler,
} from "aws-lambda";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  timeoutDelay,
  timeoutMessage,
  type TimeoutMessage,
} from "../../../shared/deadlines.ts";
import type { Session } from "../../../shared/protocol.ts";

type Send = (message: TimeoutMessage, delaySeconds: number) => Promise<void>;

/**
 * Enqueues a delayed timeout for every saved session with a running
 * deadline. Duplicates are harmless: the timeout Lambda ignores stale ones.
 */
export async function scheduleRecords(
  records: DynamoDBRecord[],
  send: Send,
  now: number,
): Promise<DynamoDBBatchResponse> {
  for (const record of records) {
    const image = record.eventName !== "REMOVE" && record.dynamodb?.NewImage;
    if (!image) continue;
    const message = timeoutMessage(
      unmarshall(image as Record<string, AttributeValue>) as Session,
    );
    if (!message) continue;
    try {
      await send(message, timeoutDelay(message.deadline, now));
    } catch (error) {
      console.error("Timeout scheduling failed", (error as Error).name);
      return {
        batchItemFailures: [
          { itemIdentifier: record.dynamodb!.SequenceNumber! },
        ],
      };
    }
  }
  return { batchItemFailures: [] };
}

const sqs = new SQSClient({});

export const handler: DynamoDBStreamHandler = (event) =>
  scheduleRecords(
    event.Records,
    async (message, delaySeconds) => {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: process.env.TIMEOUT_QUEUE_URL,
          MessageBody: JSON.stringify(message),
          DelaySeconds: delaySeconds,
        }),
      );
    },
    Date.now(),
  );
