import "dotenv/config";
import {
  createAnthropicClient,
  sendTextPrompt,
  sendVisionPromptFromFile,
} from "../infrastructure/anthropic-client.js";
import { resolveAnthropicModel } from "../providers/anthropic/config.js";

type SupportedImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set<SupportedImageMediaType>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function resolveImageMediaType(
  rawMediaType: string | undefined,
): SupportedImageMediaType {
  if (!rawMediaType) {
    return "image/png";
  }

  if (SUPPORTED_IMAGE_MEDIA_TYPES.has(rawMediaType as SupportedImageMediaType)) {
    return rawMediaType as SupportedImageMediaType;
  }

  throw new Error(
    `Unsupported ANTHROPIC_IMAGE_MEDIA_TYPE '${rawMediaType}'. Allowed: ${[
      ...SUPPORTED_IMAGE_MEDIA_TYPES,
    ].join(", ")}`,
  );
}

async function run(): Promise<void> {
  const client = createAnthropicClient();
  const model = resolveAnthropicModel(process.env.ANTHROPIC_MODEL);

  const textResponse = await sendTextPrompt(client, {
    model,
    prompt: "In one sentence, explain what this project does.",
    systemPrompt: "Be concise and concrete.",
  });

  console.log("Text response:");
  console.log(textResponse);

  const imagePath = process.env.ANTHROPIC_IMAGE_PATH;
  if (!imagePath) {
    console.log(
      "Vision sample skipped. Set ANTHROPIC_IMAGE_PATH to test image input with Sonnet.",
    );
    return;
  }
  const imageMediaType = resolveImageMediaType(process.env.ANTHROPIC_IMAGE_MEDIA_TYPE);

  const visionResponse = await sendVisionPromptFromFile(client, {
    model,
    imagePath,
    imageMediaType,
    prompt:
      "Describe this image in 5 bullet points, then provide one likely context in one sentence.",
    systemPrompt: "Prioritize visual details over speculation.",
  });

  console.log("\nVision response:");
  console.log(visionResponse);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Anthropic sample failed: ${message}`);
  process.exitCode = 1;
});
