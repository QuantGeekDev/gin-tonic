import { z } from "zod";
export const gatewayAuthSchema = z
    .object({
    token: z.string().trim().min(1),
})
    .strict();
export const gatewayClientInfoSchema = z
    .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
    capabilities: z.array(z.string().trim().min(1)).optional(),
})
    .strict();
export const gatewayConnectFrameSchema = z
    .object({
    type: z.literal("connect"),
    id: z.string().trim().min(1),
    protocolVersion: z.number().int().positive(),
    auth: gatewayAuthSchema.optional(),
    client: gatewayClientInfoSchema,
})
    .strict();
export const gatewayRequestFrameSchema = z
    .object({
    type: z.literal("req"),
    id: z.string().trim().min(1),
    method: z.string().trim().min(1),
    params: z.unknown().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
})
    .strict();
export const gatewaySuccessResponseFrameSchema = z
    .object({
    type: z.literal("res"),
    id: z.string().trim().min(1),
    ok: z.literal(true),
    result: z.unknown().optional(),
})
    .strict();
export const gatewayErrorBodySchema = z
    .object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    details: z.unknown().optional(),
})
    .strict();
export const gatewayErrorResponseFrameSchema = z
    .object({
    type: z.literal("res"),
    id: z.string().trim().min(1),
    ok: z.literal(false),
    error: gatewayErrorBodySchema,
})
    .strict();
export const gatewayEventFrameSchema = z
    .object({
    type: z.literal("event"),
    event: z.string().trim().min(1),
    seq: z.number().int().nonnegative(),
    timestamp: z.string().trim().min(1),
    payload: z.unknown().optional(),
})
    .strict();
export const gatewayAckFrameSchema = z
    .object({
    type: z.literal("ack"),
    id: z.string().trim().min(1),
})
    .strict();
export const gatewayTransportErrorFrameSchema = z
    .object({
    type: z.literal("error"),
    id: z.string().trim().min(1).optional(),
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    details: z.unknown().optional(),
})
    .strict();
export const gatewayInboundFrameSchema = z.union([
    gatewayConnectFrameSchema,
    gatewayRequestFrameSchema,
    gatewayAckFrameSchema,
]);
export const gatewayOutboundFrameSchema = z.union([
    gatewaySuccessResponseFrameSchema,
    gatewayErrorResponseFrameSchema,
    gatewayEventFrameSchema,
    gatewayTransportErrorFrameSchema,
    gatewayAckFrameSchema,
]);
export function parseGatewayInboundFrame(value) {
    return gatewayInboundFrameSchema.parse(value);
}
export function parseGatewayOutboundFrame(value) {
    return gatewayOutboundFrameSchema.parse(value);
}
//# sourceMappingURL=schema.js.map