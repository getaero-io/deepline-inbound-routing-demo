import { Deepline } from "deepline";

import type { ToolRunner } from "./contracts";

let client: ReturnType<typeof Deepline.connect> | null = null;

function getClient() {
  const apiKey = process.env.DEEPLINE_API_KEY?.trim();
  client ??= Deepline.connect({
    ...(apiKey ? { apiKey } : {}),
    baseUrl:
      process.env.INBOUND_DEMO_DEEPLINE_API_BASE_URL ||
      "https://code.deepline.com",
    // Every individual provider call fails fast below the five-second route SLO.
    // The route itself has a stricter 4.8s cap and can continue enrichment later.
    timeout: 3_600,
    maxRetries: 0,
  });
  return client;
}

export const executeTool: ToolRunner = async (tool, input) => {
  const result = await (await getClient()).tools.execute(tool, input);
  return result.toolResponse.raw;
};

export async function startPlay(name: string, input: Record<string, unknown>) {
  return (await getClient()).plays.get<Record<string, unknown>>(name).run(input);
}
