import { defineBackend } from "@aws-amplify/backend";
import { Duration, Stack, RemovalPolicy } from "aws-cdk-lib";
import {
  HttpApi,
  HttpMethod,
  CorsHttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  AttributeType,
  BillingMode,
  StreamViewType,
  Table,
} from "aws-cdk-lib/aws-dynamodb";
import {
  AuthorizationType,
  CfnApi,
  CfnChannelNamespace,
} from "aws-cdk-lib/aws-appsync";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { CfnFunction, StartingPosition } from "aws-cdk-lib/aws-lambda";
import {
  DynamoEventSource,
  SqsDlq,
} from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { gameApi } from "./functions/game-api/resource.js";
import { eventAuth } from "./functions/event-auth/resource.js";
import { eventPublisher } from "./functions/event-publisher/resource.js";

const backend = defineBackend({ gameApi, eventAuth, eventPublisher });
const stack = backend.gameApi.resources.lambda.stack;

const sessions = new Table(stack, "Sessions", {
  partitionKey: { name: "squid", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "expiresAt",
  stream: StreamViewType.NEW_IMAGE,
  removalPolicy: RemovalPolicy.RETAIN,
});
sessions.grantReadWriteData(backend.gameApi.resources.lambda);
sessions.grantReadData(backend.eventAuth.resources.lambda);
const gameFunction = backend.gameApi.resources.lambda.node
  .defaultChild as CfnFunction;
gameFunction.addPropertyOverride(
  "Environment.Variables.SESSION_TABLE",
  sessions.tableName,
);
const authorizerFunction = backend.eventAuth.resources.lambda.node
  .defaultChild as CfnFunction;
authorizerFunction.addPropertyOverride(
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
  path: "/sessions/{squid}/commands",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "CommandIntegration",
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
  name: "round-about-game-events",
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
// Every committed session write is published from the table stream, so a
// failed publish is retried by Lambda instead of depending on a later request.
const publisher = backend.eventPublisher.resources.lambda;
publisher.addToRolePolicy(
  new PolicyStatement({
    actions: ["appsync:EventPublish"],
    resources: [`${events.attrApiArn}/channelNamespace/games`],
  }),
);
(publisher.node.defaultChild as CfnFunction).addPropertyOverride(
  "Environment.Variables.EVENTS_URL",
  `https://${events.getAtt("Dns.Http").toString()}/event`,
);
publisher.addEventSource(
  new DynamoEventSource(sessions, {
    startingPosition: StartingPosition.LATEST,
    batchSize: 10,
    retryAttempts: 5,
    maxRecordAge: Duration.minutes(10),
    reportBatchItemFailures: true,
    // Failure records hold stream metadata only, never session contents.
    onFailure: new SqsDlq(
      new Queue(stack, "EventPublishFailures", {
        retentionPeriod: Duration.days(4),
      }),
    ),
  }),
);
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
