import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { documentClient } from "../shared/db.ts";
import { projectCaller, type Session } from "../../../shared/protocol.ts";
import { reconcile } from "../../../shared/deadlines.ts";
import {
  alreadyApplied,
  applyCommand,
  parseCommandRequest,
  rememberCommand,
} from "./command.ts";
import {
  authenticate,
  CommandError,
  joinSession,
  newSession,
  nickname,
  normalizeSquid,
} from "./session.ts";

const db = documentClient();
const table = process.env.SESSION_TABLE;

function response(
  statusCode: number,
  body: object,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function input(event: Parameters<APIGatewayProxyHandlerV2>[0]): unknown {
  if (!event.body || event.body.length > 1024)
    throw new Error("Invalid request.");
  try {
    return JSON.parse(event.body);
  } catch {
    throw new Error("Invalid JSON.");
  }
}

function inputNickname(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("Enter a nickname.");
  return nickname((value as { nickname?: unknown }).nickname);
}

async function load(squid: string): Promise<Session | null> {
  const result = await db.send(
    new GetCommand({ TableName: table, Key: { squid }, ConsistentRead: true }),
  );
  const session = result.Item as Session | undefined;
  return session && session.expiresAt > Math.floor(Date.now() / 1000)
    ? session
    : null;
}

function bearer(event: Parameters<APIGatewayProxyHandlerV2>[0]) {
  return event.headers.authorization?.replace(/^Bearer\s+/i, "");
}

const ERROR_STATUS = {
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  INVALID_PHASE: 409,
  STALE_VERSION: 409,
};

/**
 * Applies a command to the latest state. A version conflict reloads and
 * re-checks the rules, so of simultaneous claims exactly one is written.
 */
async function runCommand(
  event: Parameters<APIGatewayProxyHandlerV2>[0],
  loaded: Session,
): Promise<APIGatewayProxyStructuredResultV2> {
  const participantId = authenticate(loaded, bearer(event));
  if (!participantId)
    return response(401, {
      code: "UNAUTHORIZED",
      message: "Join this session first.",
    });
  let session = loaded;
  const fail = (error: CommandError) => {
    const now = Date.now();
    return response(ERROR_STATUS[error.code], {
      code: error.code,
      message: error.message,
      snapshot: projectCaller(reconcile(session, now), participantId, now),
    });
  };
  let request;
  try {
    request = parseCommandRequest(input(event));
  } catch (error) {
    if (error instanceof CommandError) return fail(error);
    throw error;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    // A retried command (same ID) answers with the current state.
    if (alreadyApplied(session, request.commandId)) {
      const now = Date.now();
      return response(
        200,
        projectCaller(reconcile(session, now), participantId, now),
      );
    }
    let next: Session;
    try {
      next = applyCommand(
        session,
        participantId,
        request.command,
        request.expectedVersion,
        Date.now(),
      );
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      return fail(error);
    }
    if (next === session)
      return response(200, projectCaller(session, participantId, Date.now()));
    try {
      await db.send(
        new PutCommand({
          TableName: table,
          Item: rememberCommand(next, request.commandId),
          ConditionExpression: "#version = :version",
          ExpressionAttributeNames: { "#version": "version" },
          ExpressionAttributeValues: { ":version": session.version },
        }),
      );
      return response(200, projectCaller(next, participantId, Date.now()));
    } catch (error) {
      if ((error as Error).name !== "ConditionalCheckFailedException")
        throw error;
    }
    const reloaded = await load(session.squid);
    if (!reloaded)
      return response(404, {
        code: "NOT_FOUND",
        message: "Session not found.",
      });
    session = reloaded;
  }
  const now = Date.now();
  return response(409, {
    code: "STALE_VERSION",
    message: "Session changed. Retry.",
    snapshot: projectCaller(reconcile(session, now), participantId, now),
  });
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  if (method === "GET" && path === "/health")
    return response(200, { status: "ok" });
  if (!table)
    return response(503, {
      code: "NOT_READY",
      message: "Session storage unavailable.",
    });

  try {
    if (method === "POST" && path === "/sessions") {
      const name = inputNickname(input(event));
      for (let attempt = 0; attempt < 3; attempt++) {
        const { session, participantId, credential } = newSession(
          name,
          Date.now(),
        );
        try {
          await db.send(
            new PutCommand({
              TableName: table,
              Item: session,
              ConditionExpression: "attribute_not_exists(squid)",
            }),
          );
          return response(201, {
            participantId,
            token: credential,
            snapshot: projectCaller(session, participantId, Date.now()),
          });
        } catch (error) {
          if ((error as Error).name !== "ConditionalCheckFailedException")
            throw error;
        }
      }
      return response(503, {
        code: "UNAVAILABLE",
        message: "Could not create a session.",
      });
    }

    const route = /^\/sessions\/([^/]+)(\/participants|\/commands)?$/.exec(
      path,
    );
    if (!route)
      return response(404, { code: "NOT_FOUND", message: "Not found." });
    const id = normalizeSquid(route[1]!);
    const session = await load(id);
    if (!session)
      return response(404, {
        code: "NOT_FOUND",
        message: "Session not found.",
      });
    if (method === "POST" && route[2] === "/participants") {
      const name = inputNickname(input(event));
      const {
        session: next,
        participantId,
        credential,
        snapshot,
      } = joinSession(reconcile(session, Date.now()), name, Date.now());
      try {
        await db.send(
          new PutCommand({
            TableName: table,
            Item: next,
            ConditionExpression: "#version = :version",
            ExpressionAttributeNames: { "#version": "version" },
            ExpressionAttributeValues: { ":version": session.version },
          }),
        );
      } catch (error) {
        if ((error as Error).name === "ConditionalCheckFailedException")
          return response(409, {
            code: "STALE_VERSION",
            message: "Session changed. Retry.",
          });
        throw error;
      }
      return response(201, { participantId, token: credential, snapshot });
    }
    if (method === "POST" && route[2] === "/commands")
      return await runCommand(event, session);
    if (method === "GET" && !route[2]) {
      const participantId = authenticate(session, bearer(event));
      if (!participantId)
        return response(401, {
          code: "UNAUTHORIZED",
          message: "Join this session first.",
        });
      // Reads show due timeouts without saving them.
      const now = Date.now();
      return response(
        200,
        projectCaller(reconcile(session, now), participantId, now),
      );
    }
    return response(404, { code: "NOT_FOUND", message: "Not found." });
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error &&
        /^(Invalid|Enter|Nickname|Session (is full|expired))/.test(
          error.message,
        ))
    ) {
      return response(400, {
        code: "INVALID_INPUT",
        message: (error as Error).message,
      });
    }
    console.error("Session request failed", (error as Error).name);
    return response(500, {
      code: "INTERNAL_ERROR",
      message: "Something went wrong.",
    });
  }
};
