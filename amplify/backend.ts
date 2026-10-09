import { defineBackend } from "@aws-amplify/backend";
import { Stack, RemovalPolicy } from "aws-cdk-lib";
import {
  HttpApi,
  HttpMethod,
  CorsHttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import {
  AuthorizationType,
  CfnApi,
  CfnChannelNamespace,
} from "aws-cdk-lib/aws-appsync";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { CfnFunction } from "aws-cdk-lib/aws-lambda";
import { gameApi } from "./functions/game-api/resource.js";
import { eventAuth } from "./functions/event-auth/resource.js";

const backend = defineBackend({ gameApi, eventAuth });
const stack = backend.gameApi.resources.lambda.stack;

const sessions = new Table(stack, "Sessions", {
  partitionKey: { name: "squid", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "expiresAt",
  removalPolicy: RemovalPolicy.RETAIN,
});
sessions.grantReadWriteData(backend.gameApi.resources.lambda);
const gameFunction = backend.gameApi.resources.lambda.node
  .defaultChild as CfnFunction;
gameFunction.addPropertyOverride(
  "Environment.Variables.SESSION_TABLE",
  sessions.tableName,
);

const api = new HttpApi(stack, "GameHttpApi", {
  corsPreflight: {
    // Replace with the Amplify Hosting domain during the production deployment.
    allowOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST],
    allowHeaders: ["content-type", "authorization"],
  },
});
api.addRoutes({
  path: "/health",
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration(
    "GameApiIntegration",
    backend.gameApi.resources.lambda,
  ),
});
api.addRoutes({
  path: "/sessions",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "HostSessionIntegration",
    backend.gameApi.resources.lambda,
  ),
});
api.addRoutes({
  path: "/sessions/{squid}/participants",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "JoinSessionIntegration",
    backend.gameApi.resources.lambda,
  ),
});
api.addRoutes({
  path: "/sessions/{squid}",
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration(
    "ReadSessionIntegration",
    backend.gameApi.resources.lambda,
  ),
});

const events = new CfnApi(stack, "GameEvents", {
  name: "one-round-game-events",
  eventConfig: {
    authProviders: [
      {
        authType: AuthorizationType.LAMBDA,
        lambdaAuthorizerConfig: {
          authorizerUri: backend.eventAuth.resources.lambda.functionArn,
        },
      },
      { authType: AuthorizationType.IAM },
    ],
    connectionAuthModes: [{ authType: AuthorizationType.LAMBDA }],
    defaultSubscribeAuthModes: [{ authType: AuthorizationType.LAMBDA }],
    defaultPublishAuthModes: [{ authType: AuthorizationType.IAM }],
  },
});
backend.eventAuth.resources.lambda.addPermission("AppSyncAuthorize", {
  principal: new ServicePrincipal("appsync.amazonaws.com"),
  sourceArn: events.attrApiArn,
});
new CfnChannelNamespace(stack, "GameNamespace", {
  apiId: events.attrApiId,
  name: "games",
});

backend.addOutput({
  custom: {
    gameApiUrl: api.url ?? "",
    gameRegion: Stack.of(stack).region,
    gameEventsUrl: `https://${events.getAtt("Dns.Http").toString()}/event`,
  },
});
