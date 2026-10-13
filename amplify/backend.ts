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
  SqsEventSource,
} from "aws-cdk-lib/aws-lambda-event-sources";
import {
  Alarm,
  ComparisonOperator,
  MathExpression,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { gameApi } from "./functions/game-api/resource.js";
import { eventAuth } from "./functions/event-auth/resource.js";
import { eventPublisher } from "./functions/event-publisher/resource.js";
import { deadlineScheduler } from "./functions/deadline-scheduler/resource.js";
import { timeout } from "./functions/timeout/resource.js";

const backend = defineBackend({
  gameApi,
  eventAuth,
  eventPublisher,
  deadlineScheduler,
  timeout,
});
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
// Failure records hold stream metadata only, never session contents.
const eventPublishFailures = new Queue(stack, "EventPublishFailures", {
  retentionPeriod: Duration.days(4),
});
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
    onFailure: new SqsDlq(eventPublishFailures),
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

// Deadlines: the stream schedules a delayed message per running deadline;
// the timeout Lambda applies it if it still matches the saved session.
const timeoutFailures = new Queue(stack, "TimeoutFailures", {
  retentionPeriod: Duration.days(4),
});
const timeoutQueue = new Queue(stack, "TimeoutQueue", {
  visibilityTimeout: Duration.seconds(60),
  retentionPeriod: Duration.days(4),
  deadLetterQueue: { queue: timeoutFailures, maxReceiveCount: 5 },
});
const deadlineScheduleFailures = new Queue(stack, "DeadlineScheduleFailures", {
  retentionPeriod: Duration.days(4),
});
const scheduler = backend.deadlineScheduler.resources.lambda;
const timeoutFunction = backend.timeout.resources.lambda;
timeoutQueue.grantSendMessages(scheduler);
timeoutQueue.grantSendMessages(timeoutFunction);
sessions.grantReadWriteData(timeoutFunction);
for (const fn of [scheduler, timeoutFunction])
  (fn.node.defaultChild as CfnFunction).addPropertyOverride(
    "Environment.Variables.TIMEOUT_QUEUE_URL",
    timeoutQueue.queueUrl,
  );
(timeoutFunction.node.defaultChild as CfnFunction).addPropertyOverride(
  "Environment.Variables.SESSION_TABLE",
  sessions.tableName,
);
scheduler.addEventSource(
  new DynamoEventSource(sessions, {
    startingPosition: StartingPosition.LATEST,
    batchSize: 10,
    retryAttempts: 5,
    maxRecordAge: Duration.minutes(10),
    reportBatchItemFailures: true,
    onFailure: new SqsDlq(deadlineScheduleFailures),
  }),
);
timeoutFunction.addEventSource(
  new SqsEventSource(timeoutQueue, {
    batchSize: 10,
    reportBatchItemFailures: true,
  }),
);

// Anything in a failure queue means a timeout or broadcast was lost.
for (const [id, queue] of [
  ["TimeoutFailuresAlarm", timeoutFailures],
  ["DeadlineScheduleFailuresAlarm", deadlineScheduleFailures],
  ["EventPublishFailuresAlarm", eventPublishFailures],
] as const)
  new Alarm(stack, id, {
    metric: queue.metricApproximateNumberOfMessagesVisible({
      period: Duration.seconds(60),
    }),
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });

// Throttles across all game functions: the account allows only a few
// concurrent Lambdas, so this is the likeliest production problem.
const gameFunctions = [
  backend.gameApi.resources.lambda,
  backend.eventAuth.resources.lambda,
  publisher,
  scheduler,
  timeoutFunction,
];
new Alarm(stack, "LambdaThrottlesAlarm", {
  metric: new MathExpression({
    expression: gameFunctions.map((_, i) => `t${i}`).join("+"),
    usingMetrics: Object.fromEntries(
      gameFunctions.map((fn, i) => [
        `t${i}`,
        fn.metricThrottles({ period: Duration.seconds(60), statistic: "Sum" }),
      ]),
    ),
    period: Duration.seconds(60),
  }),
  threshold: 1,
  evaluationPeriods: 1,
  comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
  treatMissingData: TreatMissingData.NOT_BREACHING,
});
// The game API answers its own exceptions with 500, so Lambda's Errors
// metric misses them; the API's 5xx count catches those and throttles.
new Alarm(stack, "GameApiServerErrorsAlarm", {
  metric: api.metricServerError({ period: Duration.seconds(300) }),
  threshold: 1,
  evaluationPeriods: 1,
  comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
  treatMissingData: TreatMissingData.NOT_BREACHING,
});

backend.addOutput({
  custom: {
    gameApiUrl: api.url ?? "",
    gameRegion: Stack.of(stack).region,
    gameEventsUrl: `https://${events.getAtt("Dns.Http").toString()}/event`,
  },
});
