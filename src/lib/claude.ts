import Anthropic from "@anthropic-ai/sdk";

const globalForClaude = globalThis as unknown as {
  claude: Anthropic | undefined;
};

export const claude =
  globalForClaude.claude ??
  new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

if (process.env.NODE_ENV !== "production") globalForClaude.claude = claude;
