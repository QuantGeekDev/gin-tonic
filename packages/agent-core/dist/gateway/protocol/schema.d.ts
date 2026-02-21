import { z } from "zod";
export declare const gatewayAuthSchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strict>;
export declare const gatewayClientInfoSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    version: z.ZodOptional<z.ZodString>;
    capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const gatewayConnectFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"connect">;
    id: z.ZodString;
    protocolVersion: z.ZodNumber;
    auth: z.ZodOptional<z.ZodObject<{
        token: z.ZodString;
    }, z.core.$strict>>;
    client: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        version: z.ZodOptional<z.ZodString>;
        capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const gatewayRequestFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"req">;
    id: z.ZodString;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodUnknown>;
    idempotencyKey: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const gatewaySuccessResponseFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"res">;
    id: z.ZodString;
    ok: z.ZodLiteral<true>;
    result: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strict>;
export declare const gatewayErrorBodySchema: z.ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
    details: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strict>;
export declare const gatewayErrorResponseFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"res">;
    id: z.ZodString;
    ok: z.ZodLiteral<false>;
    error: z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const gatewayEventFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"event">;
    event: z.ZodString;
    seq: z.ZodNumber;
    timestamp: z.ZodString;
    payload: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strict>;
export declare const gatewayAckFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"ack">;
    id: z.ZodString;
}, z.core.$strict>;
export declare const gatewayTransportErrorFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"error">;
    id: z.ZodOptional<z.ZodString>;
    code: z.ZodString;
    message: z.ZodString;
    details: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strict>;
export declare const gatewayInboundFrameSchema: z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodLiteral<"connect">;
    id: z.ZodString;
    protocolVersion: z.ZodNumber;
    auth: z.ZodOptional<z.ZodObject<{
        token: z.ZodString;
    }, z.core.$strict>>;
    client: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        version: z.ZodOptional<z.ZodString>;
        capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"req">;
    id: z.ZodString;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodUnknown>;
    idempotencyKey: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"ack">;
    id: z.ZodString;
}, z.core.$strict>]>;
export declare const gatewayOutboundFrameSchema: z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodLiteral<"res">;
    id: z.ZodString;
    ok: z.ZodLiteral<true>;
    result: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"res">;
    id: z.ZodString;
    ok: z.ZodLiteral<false>;
    error: z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"event">;
    event: z.ZodString;
    seq: z.ZodNumber;
    timestamp: z.ZodString;
    payload: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"error">;
    id: z.ZodOptional<z.ZodString>;
    code: z.ZodString;
    message: z.ZodString;
    details: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"ack">;
    id: z.ZodString;
}, z.core.$strict>]>;
export type GatewayConnectFrame = z.infer<typeof gatewayConnectFrameSchema>;
export type GatewayRequestFrame = z.infer<typeof gatewayRequestFrameSchema>;
export type GatewaySuccessResponseFrame = z.infer<typeof gatewaySuccessResponseFrameSchema>;
export type GatewayErrorResponseFrame = z.infer<typeof gatewayErrorResponseFrameSchema>;
export type GatewayEventFrame = z.infer<typeof gatewayEventFrameSchema>;
export type GatewayAckFrame = z.infer<typeof gatewayAckFrameSchema>;
export type GatewayTransportErrorFrame = z.infer<typeof gatewayTransportErrorFrameSchema>;
export type GatewayInboundFrame = z.infer<typeof gatewayInboundFrameSchema>;
export type GatewayOutboundFrame = z.infer<typeof gatewayOutboundFrameSchema>;
export declare function parseGatewayInboundFrame(value: unknown): GatewayInboundFrame;
export declare function parseGatewayOutboundFrame(value: unknown): GatewayOutboundFrame;
//# sourceMappingURL=schema.d.ts.map