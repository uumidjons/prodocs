import type { z } from 'zod';
import { Errors } from './errors.js';

/**
 * Validate a request body against a Zod schema, throwing a 400 with field-level
 * details on failure. Centralizes the zod→ApiError mapping so routes stay thin.
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const details: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '(body)';
      (details[key] ??= []).push(issue.message);
    }
    throw Errors.validation(details);
  }
  return result.data;
}
