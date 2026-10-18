import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { env } from "../configs/env.js";
import { redisCommand } from "../configs/redis.js";

function authLimit(name: string, limit: number, failuresOnly = false) {
  const store = new RedisStore({
    sendCommand: redisCommand,
    prefix: env.redisPrefix + "rate:" + name + ":",
  });
  if (failuresOnly) {
    const decrement = store.decrement.bind(store);
    store.decrement = async key => {
      // Refunds run after the response. A Redis outage here must not turn into
      // an unhandled rejection; keep the attempt counted if refunding fails.
      try {
        await decrement(key);
      } catch {
        console.error("Unable to refund login rate-limit attempt");
      }
    };
  }
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store,
    skipSuccessfulRequests: failuresOnly,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    message: { error: "Too many attempts. Please try again in a minute" },
  });
}

export const otpRateLimit = authLimit("otp", 3);
export const registerRateLimit = authLimit("register", 5);
export const loginRateLimit = authLimit("login", 5, true);
