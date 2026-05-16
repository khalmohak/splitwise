import type { SQSBatchResponse, SQSHandler } from "aws-lambda";
import { deliverAsyncJob } from "../lib/async-job-delivery.js";
import { parseAsyncJob } from "../lib/async-jobs.js";

export const handler: SQSHandler = async (event) => {
  const batchItemFailures = (
    await Promise.all(
      event.Records.map(async (record) => {
        try {
          const job = parseAsyncJob(record.body);
          if (process.env.NOTIFY_DEBUG === "1") {
            console.log("[async-jobs] delivering", {
              messageId: record.messageId,
              jobId: job.jobId,
              type: job.type,
            });
          }
          await deliverAsyncJob(job);
          return null;
        } catch (error) {
          console.error("[async-jobs] failed", {
            messageId: record.messageId,
            error: error instanceof Error ? error.message : error,
          });
          return { itemIdentifier: record.messageId };
        }
      }),
    )
  ).filter((value): value is SQSBatchResponse["batchItemFailures"][number] => value !== null);

  return { batchItemFailures };
};
