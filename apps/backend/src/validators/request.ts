import { z } from "zod";
import { HttpError } from "../utils/http-error.js";

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(400, "Invalid request", result.error.issues.map((issue) => ({
      field: issue.path.join("."), message: issue.message,
    })));
  }
  return result.data;
}

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const registerSchema = z.strictObject({
  name: z.string().trim().min(1).max(100), email,
  password: z.string().min(15).max(128),
});
export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(128) });
export const organizationSchema = z.strictObject({ name: z.string().trim().min(1).max(100) });
export const workspaceSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).default(""),
});
export const documentSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(100000).refine((value) => value.trim().length > 0, "Content cannot be blank"),
});
export const uuidSchema = z.uuid();
export const paginationSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
