import { z } from "zod";

export const ApiErrorObjectSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().nullable().optional(),
});

export const ApiErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  requestId: z.string(),
  error: ApiErrorObjectSchema,
});

export function createApiSuccessEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    requestId: z.string(),
    data: dataSchema,
  });
}

export type ApiErrorObject = z.infer<typeof ApiErrorObjectSchema>;
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;
