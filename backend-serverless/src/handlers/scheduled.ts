import type { ScheduledHandler } from "aws-lambda";

export const handler: ScheduledHandler = async (event) => {
  console.log("scheduled tick", { time: event.time });
  // Wire up reminders / digest jobs / cleanups here.
};
