import { env } from "./env.js";

export const bullmqConnection = {
  host: env.redisHost,
  port: env.redisPort,
  password: env.redisPassword,
  connectTimeout: 5000,
};

export const bullmqPrefix = env.redisPrefix + "bullmq";
export { DOCUMENT_QUEUE_NAME } from "@pikaai/queues";
