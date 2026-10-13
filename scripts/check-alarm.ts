// Development only: proves an alarm fires by putting one test message into
// the sandbox TimeoutFailures queue, then removes exactly that message and
// waits for the alarm to clear. Needs AWS_PROFILE=chreisel.
import {
  DeleteMessageCommand,
  ListQueuesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import {
  CloudWatchClient,
  DescribeAlarmsCommand,
} from "@aws-sdk/client-cloudwatch";

const BODY = JSON.stringify({ test: "check-alarm" });
const sqs = new SQSClient({});
const cloudwatch = new CloudWatchClient({});
const queueUrl = (await sqs.send(new ListQueuesCommand({}))).QueueUrls?.find(
  (url) => url.includes("roundaboutdev") && url.includes("TimeoutFailures"),
);
const alarmName = (
  await cloudwatch.send(new DescribeAlarmsCommand({ MaxRecords: 100 }))
).MetricAlarms?.find(
  (alarm) =>
    alarm.AlarmName?.includes("roundabout") &&
    alarm.AlarmName.includes("TimeoutFailuresAlarm"),
)?.AlarmName;
if (!queueUrl || !alarmName) throw new Error("Queue or alarm not found");

async function waitFor(state: string) {
  const started = Date.now();
  while (Date.now() - started < 5 * 60_000) {
    const alarm = (
      await cloudwatch.send(
        new DescribeAlarmsCommand({ AlarmNames: [alarmName] }),
      )
    ).MetricAlarms?.[0];
    if (alarm?.StateValue === state)
      return Math.round((Date.now() - started) / 1000);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return null;
}

await sqs.send(
  new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: BODY }),
);
const firedAfter = await waitFor("ALARM");

// Remove only the test message; leave anything else in the queue alone.
let removed = false;
for (let attempt = 0; attempt < 10 && !removed; attempt++) {
  const { Messages = [] } = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      VisibilityTimeout: 5,
      WaitTimeSeconds: 2,
    }),
  );
  for (const message of Messages)
    if (message.Body === BODY) {
      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );
      removed = true;
    }
}
const clearedAfter = removed ? await waitFor("OK") : null;

console.log({
  alarmName,
  firedAfterSeconds: firedAfter,
  removed,
  clearedAfterSeconds: clearedAfter,
});
if (firedAfter === null || !removed || clearedAfter === null)
  process.exitCode = 1;
