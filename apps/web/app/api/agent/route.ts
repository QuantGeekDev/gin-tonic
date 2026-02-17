import { NextResponse } from "next/server";
import {
  composeSystemPrompt,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MAX_TURNS,
  handleMessage,
  SESSION_SCOPES,
  SessionStore,
} from "@jihn/agent-core";
import { createAnthropicClient } from "@cli/infrastructure/anthropic-client";
import { createToolRegistry } from "@cli/infrastructure/register-tools";
import { resolveAnthropicModel } from "@cli/providers/anthropic/config";
import type { SessionScope } from "@jihn/agent-core";

export const runtime = "nodejs";
const sessionStore = new SessionStore();

interface AgentTurnRequest {
  text: string;
  peerId: string;
  scope?: SessionScope;
  channelId?: string;
  agentId?: string;
  maxTurns?: number;
  maxTokens?: number;
}

export async function GET(): Promise<NextResponse> {
  const registry = createToolRegistry();
  const model = resolveAnthropicModel(process.env.ANTHROPIC_MODEL);

  return NextResponse.json({
    model,
    tools: registry.getDefinitions().map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const rawBody = (await request.json()) as unknown;
    if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
      return NextResponse.json(
        {
          error: "request body must be a JSON object",
        },
        { status: 400 },
      );
    }

    const body = rawBody as Record<string, unknown>;
    if ("input" in body || "messages" in body) {
      return NextResponse.json(
        {
          error: "legacy fields are not supported; use only text + peerId + optional routing fields",
        },
        { status: 400 },
      );
    }

    const allowedKeys = new Set([
      "text",
      "peerId",
      "scope",
      "channelId",
      "agentId",
      "maxTurns",
      "maxTokens",
    ]);
    const unsupportedKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
    if (unsupportedKeys.length > 0) {
      return NextResponse.json(
        {
          error: `unsupported field(s): ${unsupportedKeys.join(", ")}`,
        },
        { status: 400 },
      );
    }

    if (typeof body.text !== "string" || body.text.trim().length === 0) {
      return NextResponse.json(
        {
          error: "text must be a non-empty string",
        },
        { status: 400 },
      );
    }
    if (typeof body.peerId !== "string" || body.peerId.trim().length === 0) {
      return NextResponse.json(
        {
          error: "peerId must be a non-empty string",
        },
        { status: 400 },
      );
    }
    if (body.scope !== undefined && !SESSION_SCOPES.includes(body.scope as SessionScope)) {
      return NextResponse.json(
        {
          error: `scope must be one of: ${SESSION_SCOPES.join(", ")}`,
        },
        { status: 400 },
      );
    }
    if (body.channelId !== undefined && typeof body.channelId !== "string") {
      return NextResponse.json(
        {
          error: "channelId must be a string when provided",
        },
        { status: 400 },
      );
    }
    if (body.agentId !== undefined && typeof body.agentId !== "string") {
      return NextResponse.json(
        {
          error: "agentId must be a string when provided",
        },
        { status: 400 },
      );
    }
    if (
      body.maxTurns !== undefined &&
      (typeof body.maxTurns !== "number" || !Number.isInteger(body.maxTurns) || body.maxTurns <= 0)
    ) {
      return NextResponse.json(
        {
          error: "maxTurns must be a positive integer when provided",
        },
        { status: 400 },
      );
    }
    if (
      body.maxTokens !== undefined &&
      (typeof body.maxTokens !== "number" || !Number.isInteger(body.maxTokens) || body.maxTokens <= 0)
    ) {
      return NextResponse.json(
        {
          error: "maxTokens must be a positive integer when provided",
        },
        { status: 400 },
      );
    }

    const typedBody: AgentTurnRequest = {
      text: body.text as string,
      peerId: body.peerId as string,
      ...(body.scope !== undefined ? { scope: body.scope as SessionScope } : {}),
      ...(body.channelId !== undefined ? { channelId: body.channelId as string } : {}),
      ...(body.agentId !== undefined ? { agentId: body.agentId as string } : {}),
      ...(body.maxTurns !== undefined ? { maxTurns: body.maxTurns as number } : {}),
      ...(body.maxTokens !== undefined ? { maxTokens: body.maxTokens as number } : {}),
    };
    const client = createAnthropicClient();
    const model = resolveAnthropicModel(process.env.ANTHROPIC_MODEL);
    const registry = createToolRegistry();
    const userInput = typedBody.text.trim();
    const peerId = typedBody.peerId.trim();
    const effectiveAgentId = typedBody.agentId?.trim() || "main";
    const systemPrompt = await composeSystemPrompt({
      workspaceDir: process.cwd(),
      agentId: effectiveAgentId,
    });

    const toolEvents: Array<
      | { kind: "call"; name: string; input: Record<string, unknown> }
      | { kind: "result"; name: string; output: string }
    > = [];

    const result = await handleMessage({
      client,
      model,
      tools: registry.getDefinitions(),
      text: userInput,
      routing: {
        agentId: effectiveAgentId,
        scope: typedBody.scope,
        channelId: typedBody.channelId ?? "web",
        peerId,
      },
      sessionStore,
      systemPrompt,
      maxTurns: typedBody.maxTurns ?? DEFAULT_MAX_TURNS,
      maxTokens: typedBody.maxTokens ?? DEFAULT_MAX_TOKENS,
      async executeTool(name, input) {
        toolEvents.push({ kind: "call", name, input });
        const output = await registry.execute<string>(name, input);
        toolEvents.push({ kind: "result", name, output });
        return output;
      },
    });

    return NextResponse.json({
      text: result.text,
      messages: result.messages,
      usage: result.usage,
      toolEvents,
      model,
      session: result.routing,
      persistenceMode: result.persistenceMode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
