import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { authenticate, normalizeSquid } from "../game-api/session.ts";
import type { Session } from "../../../shared/protocol.ts";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type EventAuthRequest = {
  authorizationToken?: string;
  requestContext: {
    operation: "EVENT_CONNECT" | "EVENT_SUBSCRIBE" | "EVENT_PUBLISH";
    channel?: string;
  };
};

export async function handler(event: EventAuthRequest) {
  // Connection has no channel. Membership is checked separately for every subscribe.
  if (event.requestContext.operation === "EVENT_CONNECT") {
    return {
      isAuthorized:
        !!event.authorizationToken && event.authorizationToken.length <= 256,
      ttlOverride: 0,
    };
  }
  if (event.requestContext.operation !== "EVENT_SUBSCRIBE")
    return { isAuthorized: false, ttlOverride: 0 };
  const match = /^\/games\/([0-9A-HJKMNP-TV-Z]{12})$/.exec(
    event.requestContext.channel ?? "",
  );
  if (!match || !event.authorizationToken || !process.env.SESSION_TABLE)
    return { isAuthorized: false, ttlOverride: 0 };
  const squid = normalizeSquid(match[1]!);
  try {
    const result = await db.send(
      new GetCommand({
        TableName: process.env.SESSION_TABLE,
        Key: { squid },
        ConsistentRead: true,
      }),
    );
    const session = result.Item as Session | undefined;
    return {
      isAuthorized:
        !!session &&
        session.expiresAt > Math.floor(Date.now() / 1000) &&
        authenticate(session, event.authorizationToken) !== null,
      ttlOverride: 0,
    };
  } catch {
    return { isAuthorized: false, ttlOverride: 0 };
  }
}
