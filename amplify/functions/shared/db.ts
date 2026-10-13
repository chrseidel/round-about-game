import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * Game results contain optional fields that are `undefined` (for example no
 * guessed gap after an Overtime timeout); DynamoDB cannot store those.
 */
export const MARSHALL_OPTIONS = { removeUndefinedValues: true };

export function documentClient() {
  return DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: MARSHALL_OPTIONS,
  });
}
