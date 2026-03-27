import Anthropic from "@anthropic-ai/sdk";

const globalForClaude = globalThis as unknown as {
  claude: Anthropic | null | undefined;
};

function createClaudeClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.startsWith("sk-ant-...")) return null;
  return new Anthropic({ apiKey });
}

export const claude: Anthropic | null =
  globalForClaude.claude !== undefined
    ? globalForClaude.claude
    : createClaudeClient();

if (process.env.NODE_ENV !== "production") globalForClaude.claude = claude;
