import nodemailer from "nodemailer";
import { env } from "./env.js";
import { HttpError } from "../utils/http-error.js";

const mailer = nodemailer.createTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: env.smtpSecure,
  requireTLS: env.production,
  auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  disableFileAccess: true,
  disableUrlAccess: true,
});

export async function sendOtpEmail(email: string, otp: string): Promise<void> {
  if (!env.smtpHost || !env.smtpFrom) {
    throw new HttpError(503, "Email sending is not configured");
  }
  try {
    await mailer.sendMail({
      from: env.smtpFrom,
      to: email,
      subject: "Your PikaAI registration code",
      text: `Your PikaAI registration code is ${otp}. It expires in 5 minutes.`,
    });
  } catch {
    throw new HttpError(503, "Unable to send OTP. Please try again later");
  }
}
