import { NextResponse } from "next/server";
import { getGatewayClient } from "../../../gateway-client";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const error = url.searchParams.get("error")?.trim();

  if (error) {
    return NextResponse.redirect(
      new URL(`/?mcp_oauth=error&message=${encodeURIComponent(error)}`, url),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/?mcp_oauth=error&message=missing_code_or_state", url),
    );
  }

  try {
    const gateway = await getGatewayClient();
    await gateway.request("mcp.complete_oauth", { code, state });
    return NextResponse.redirect(new URL("/?mcp_oauth=success", url));
  } catch (oauthError) {
    const message = oauthError instanceof Error ? oauthError.message : String(oauthError);
    return NextResponse.redirect(
      new URL(`/?mcp_oauth=error&message=${encodeURIComponent(message)}`, url),
    );
  }
}
