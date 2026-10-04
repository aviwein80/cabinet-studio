/**
 * Vision-model providers for the spec-sheet reader (hardware sheets and customer drawings).
 * One interface, several providers; each uses the shop's own API key, stored on this computer only (never in the shop
 * data file). The result is always a draft: the same review and approval as every other import.
 *
 * Request building and response parsing are pure so they can be shared by the browser and the
 * Electron main process (which makes the call there, so the key never reaches the page).
 */

export type AiProviderId = "openai" | "anthropic" | "google" | "xai";

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  defaultModel: string;
  keyHint: string;
  keyUrl: string;
  host: string;
}

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4.1",
    keyHint: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    host: "https://api.openai.com",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-sonnet-4-5",
    keyHint: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    host: "https://api.anthropic.com",
  },
  {
    id: "google",
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    keyHint: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
    host: "https://generativelanguage.googleapis.com",
  },
  {
    id: "xai",
    label: "xAI Grok",
    defaultModel: "grok-4",
    keyHint: "xai-…",
    keyUrl: "https://console.x.ai",
    host: "https://api.x.ai",
  },
];

export const providerInfo = (id: AiProviderId) =>
  AI_PROVIDERS.find((p) => p.id === id)!;

export interface AiSettings {
  /** 'off' = only the built-in offline sheet reader. */
  provider: AiProviderId | "off";
  /** Model per provider; empty uses the provider's default. */
  models?: Partial<Record<AiProviderId, string>>;
}

/**
 * Anthropic Claude Sonnet 4.5 is the default: strong at reading dimensioned technical drawings
 * and scans. Without a saved key the offline reader is used.
 */
export const DEFAULT_AI: AiSettings = { provider: "anthropic", models: {} };

export const modelOf = (s: AiSettings | undefined, id: AiProviderId) =>
  s?.models?.[id]?.trim() || providerInfo(id).defaultModel;

export interface PageImage {
  page: number;
  /** e.g. image/png */
  mime: string;
  base64: string;
}

/** What the app asks for; the transport adds the key. */
export interface AiCall {
  provider: AiProviderId;
  model: string;
  prompt: string;
  images: PageImage[];
}

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export function buildRequest(call: AiCall, key: string): HttpRequest {
  const info = providerInfo(call.provider);
  const text = call.images.length
    ? `${call.prompt}\n\nThe page images follow, in order: ${call.images.map((i) => `page ${i.page}`).join(", ")}.`
    : call.prompt;
  switch (call.provider) {
    case "openai":
    case "xai":
      return {
        url: `${info.host}/v1/chat/completions`,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: call.model,
          temperature: 0,
          ...(call.provider === "openai"
            ? { response_format: { type: "json_object" } }
            : {}),
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text },
                ...call.images.map((i) => ({
                  type: "image_url",
                  image_url: {
                    url: `data:${i.mime};base64,${i.base64}`,
                    detail: "high",
                  },
                })),
              ],
            },
          ],
        }),
      };
    case "anthropic":
      return {
        url: `${info.host}/v1/messages`,
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: call.model,
          max_tokens: 4096,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: [
                ...call.images.map((i) => ({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: i.mime,
                    data: i.base64,
                  },
                })),
                { type: "text", text },
              ],
            },
          ],
        }),
      };
    case "google":
      return {
        url: `${info.host}/v1beta/models/${encodeURIComponent(call.model)}:generateContent`,
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text },
                ...call.images.map((i) => ({
                  inline_data: { mime_type: i.mime, data: i.base64 },
                })),
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),
      };
  }
}

/** The model's text out of each provider's response body; throws with the provider's error message. */
export function responseText(
  provider: AiProviderId,
  status: number,
  body: string,
): string {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(body);
  } catch {
    throw new Error(
      `${providerInfo(provider).label} returned ${status} with a non-JSON body.`,
    );
  }
  const err = (j.error as { message?: string } | undefined)?.message;
  if (status >= 400 || err)
    throw new Error(
      `${providerInfo(provider).label} error ${status}: ${err ?? "request failed"}`,
    );
  if (provider === "openai" || provider === "xai")
    return (
      (j.choices as { message: { content: string } }[])?.[0]?.message
        ?.content ?? ""
    );
  if (provider === "anthropic")
    return ((j.content as { type: string; text?: string }[]) ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
  return (
    (j.candidates as { content?: { parts?: { text?: string }[] } }[])?.[0]
      ?.content?.parts ?? []
  )
    .map((p) => p.text ?? "")
    .join("");
}

export type AiTransport = (call: AiCall) => Promise<string>;

/** Direct HTTPS call with a key held in this process (browser preview, CLI, Electron main). */
export async function callProvider(
  call: AiCall,
  key: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (!key)
    throw new Error(
      `No ${providerInfo(call.provider).label} API key saved on this computer.`,
    );
  const req = buildRequest(call, key);
  const res = await fetcher(req.url, {
    method: "POST",
    headers: req.headers,
    body: req.body,
  });
  return responseText(call.provider, res.status, await res.text());
}
