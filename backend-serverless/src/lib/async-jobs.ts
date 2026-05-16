import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "./env.js";
import { notifyEventSchema } from "./notify-events.js";

const email = z.string().trim().email();
const nonEmpty = z.string().trim().min(1);
const url = z.string().url();

const asyncJobSchema = z.discriminatedUnion("type", [
  z.object({
    jobId: z.string().uuid(),
    enqueuedAt: z.string().datetime(),
    type: z.literal("notify"),
    event: notifyEventSchema,
  }),
  z.object({
    jobId: z.string().uuid(),
    enqueuedAt: z.string().datetime(),
    type: z.literal("email_verification"),
    to: email,
    name: nonEmpty.max(120),
    verifyUrl: url,
  }),
  z.object({
    jobId: z.string().uuid(),
    enqueuedAt: z.string().datetime(),
    type: z.literal("password_reset"),
    to: email,
    name: nonEmpty.max(120),
    resetUrl: url,
  }),
  z.object({
    jobId: z.string().uuid(),
    enqueuedAt: z.string().datetime(),
    type: z.literal("group_invite_email"),
    to: email,
    groupName: nonEmpty.max(120),
    inviterName: nonEmpty.max(120),
    inviteUrl: url,
  }),
]);

export type AsyncJob = z.infer<typeof asyncJobSchema>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type AsyncJobInput = DistributiveOmit<AsyncJob, "jobId" | "enqueuedAt">;

let _client: SQSClient | undefined;

function sqsClient(): SQSClient {
  if (!_client) {
    _client = new SQSClient({ region: env.AWS_REGION });
  }
  return _client;
}

function materializeAsyncJob(input: AsyncJobInput): AsyncJob {
  return asyncJobSchema.parse({
    jobId: randomUUID(),
    enqueuedAt: new Date().toISOString(),
    ...input,
  });
}

export function parseAsyncJob(body: string): AsyncJob {
  const parsed = JSON.parse(body) as unknown;
  return asyncJobSchema.parse(parsed);
}

export async function enqueueAsyncJob(input: AsyncJobInput): Promise<AsyncJob> {
  const job = materializeAsyncJob(input);

  if (!env.ASYNC_JOBS_QUEUE_URL) {
    if (env.STAGE === "prod") {
      throw new Error("ASYNC_JOBS_QUEUE_URL is not configured");
    }

    if (process.env.NOTIFY_DEBUG === "1") {
      console.log("[async-jobs] queue disabled, delivering inline", {
        jobId: job.jobId,
        type: job.type,
      });
    }

    const { deliverAsyncJob } = await import("./async-job-delivery.js");
    await deliverAsyncJob(job);
    return job;
  }

  await sqsClient().send(
    new SendMessageCommand({
      QueueUrl: env.ASYNC_JOBS_QUEUE_URL,
      MessageBody: JSON.stringify(job),
    }),
  );

  if (process.env.NOTIFY_DEBUG === "1") {
    console.log("[async-jobs] enqueued", {
      jobId: job.jobId,
      type: job.type,
    });
  }

  return job;
}
