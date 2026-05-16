// Lightweight OpenAI client wrapped around the chat-completions REST endpoint
// so we don't pull in the full SDK. Two callers: receipt OCR (vision) and
// expense metadata suggestion. Both can degrade to empty/null outputs when the
// API key is absent or the call fails — endpoints stay alive.

import { env } from "./env.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 25_000;

export type VisionModel = "gpt-4o" | "gpt-4.1" | "gpt-4.1-mini";

type ChatMessage = {
  role: "system" | "user";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  response_format?: { type: "json_object" };
};

type ChatResponse = {
  choices: Array<{ message: { content: string | null } }>;
};

export function hasOpenAI(): boolean {
  return !!env.OPENAI_API_KEY;
}

export async function chatJson(
  req: ChatRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string | null> {
  if (!hasOpenAI()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        ...req,
        response_format: req.response_format ?? { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("openai non-2xx", res.status, await safeText(res));
      return null;
    }
    const data = (await res.json()) as ChatResponse;
    return data.choices[0]?.message?.content ?? null;
  } catch (err) {
    console.error("openai call failed", err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
