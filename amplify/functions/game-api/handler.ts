import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (
    event.requestContext.http.method === "GET" &&
    event.rawPath === "/health"
  ) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "ok" }),
    };
  }
  return { statusCode: 404, body: JSON.stringify({ code: "NOT_FOUND" }) };
};
