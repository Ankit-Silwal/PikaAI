import { createHash, createHmac, randomInt, randomUUID } from "node:crypto";
import { env } from "../../configs/env.js";
import { sendOtpEmail } from "../../configs/mail.js";
import { redisCommand } from "../../configs/redis.js";
import { HttpError } from "../../utils/http-error.js";

const OTP_SECONDS = 5 * 60;

function otpKey(email: string): string {
  return env.redisPrefix + "otp:" + createHash("sha256").update(email).digest("hex");
}

function otpHash(email: string, otp: string): string {
  return createHmac("sha256", env.accessSecret).update("registration-otp:" + email + ":" + otp).digest("hex");
}

export async function sendRegistrationOtp(email: string): Promise<void> {
  const otp = randomInt(100000, 1000000).toString();
  const key = otpKey(email);
  const id = randomUUID();
  const value = JSON.stringify({ id, hash: otpHash(email, otp), attempts: 5 });
  await redisCommand("SET", key, value, "EX", OTP_SECONDS.toString());
  try {
    await sendOtpEmail(email, otp);
  } catch (error) {
    // A failed send must not remove a newer code from a concurrent resend.
    await redisCommand("EVAL", `
      local value = redis.call('GET', KEYS[1])
      if value and cjson.decode(value).id == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `, "1", key, id);
    throw error;
  }
}

export async function consumeRegistrationOtp(email: string, otp: string): Promise<void> {
  // Checking, limiting guesses, and consuming the code are one atomic operation.
  const valid = await redisCommand("EVAL", `
    local value = redis.call('GET', KEYS[1])
    if not value then return 0 end
    local code = cjson.decode(value)
    if code.hash == ARGV[1] then
      redis.call('DEL', KEYS[1])
      return 1
    end
    code.attempts = code.attempts - 1
    if code.attempts <= 0 then
      redis.call('DEL', KEYS[1])
    else
      redis.call('SET', KEYS[1], cjson.encode(code), 'KEEPTTL')
    end
    return 0
  `, "1", otpKey(email), otpHash(email, otp));
  if (valid !== 1) throw new HttpError(400, "Invalid or expired OTP. Request a new code if needed");
}
