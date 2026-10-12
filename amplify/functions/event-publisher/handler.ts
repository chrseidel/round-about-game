import type {
  DynamoDBBatchResponse,
  DynamoDBRecord,
  DynamoDBStreamHandler,
} from "aws-lambda";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  publicEvent,
  type PublicEvent,
  type Session,
} from "../../../shared/protocol.ts";
import { publishEvent } from "./publish.ts";

type Publish = (squid: string, event: PublicEvent) => Promise<void>;

/**
 * Publishes the public projection of each committed session write, in stream
 * order. Events carry full snapshots, so only the newest image per session in
 * a batch is sent. A failure stops the batch and reports that record, making
 * Lambda retry it and everything after it.
 */
export async function publishRecords(
  records: DynamoDBRecord[],
  publish: Publish,
  now: number,
): Promise<DynamoDBBatchResponse> {
  const images = records.map((record) =>
    record.eventName !== "REMOVE" && record.dynamodb?.NewImage
      ? (unmarshall(
          record.dynamodb.NewImage as Record<string, AttributeValue>,
        ) as Session)
      : null,
  );
  for (const [index, session] of images.entries()) {
    if (!session) continue;
    if (images.slice(index + 1).some((later) => later?.squid === session.squid))
      continue;
    try {
      await publish(session.squid, publicEvent(session, now));
    } catch (error) {
      console.error("Session event publish failed", (error as Error).name);
      return {
        batchItemFailures: [
          { itemIdentifier: records[index]!.dynamodb!.SequenceNumber! },
        ],
      };
    }
  }
  return { batchItemFailures: [] };
}

export const handler: DynamoDBStreamHandler = (event) =>
  publishRecords(event.Records, publishEvent, Date.now());
