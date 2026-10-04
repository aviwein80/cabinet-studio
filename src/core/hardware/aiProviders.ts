/**
 * Vision-model drafting of hardware patterns from PDF spec sheets. One interface, several
 * providers; each uses the shop's own API key, stored on this computer only (never in the shop
 * data file). The result is always a draft: the same review and approval as every other import.
 *
 * Request building and response parsing are pure so they can be shared by the browser and the
 * Electron main process (which makes the call there, so the key never reaches the page).
 */
import type { FaceId, HardwarePattern, PatternHole } from "../../cam/types";
import type {
  Finding,
  PatternDraft,
  PatternDrafter,
  TextPage,
} from "./patternImport";

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

export const DEFAULT_AI: AiSettings = { provider: "off", models: {} };

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

export const DRAFT_PROMPT = `You read hardware spec sheets (hinges, mounting plates, drawer runners, connectors) for a cabinet shop and extract the drilling pattern.

Return ONLY a JSON object, no prose, with this shape:
{"name": string, "manufacturer": string, "partNumber": string|null,
 "holes": [{"x": number|null, "y": number|null, "diameter": number|null, "depth": number|null, "face": "top"|"underside"|"edge",
            "page": number, "quote": string}],
 "notes": string, "warnings": [string]}

Frame: the reference edge is the edge the sheet measures from (door edge for hinge cups, cabinet front edge for runners and plates). x runs along that edge, y goes into the panel away from it. For "edge" holes, y is the depth below the top face. Millimetres; convert inches (x 25.4) and say so in warnings.

Rules:
- Use only numbers printed on the sheet. If a value is not printed, use null. Never estimate.
- "quote" is the exact text or dimension label on the sheet the hole's numbers came from; "page" is its page number.
- If the sheet lists several variants (e.g. K = 3 to 6), pick none: use null and list the options in warnings.
- Put anything unclear in warnings.`;

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

const FACE: Record<string, FaceId> = { top: 1, underside: 6, edge: 2 };

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.round(v * 1000) / 1000
    : NaN;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, "");

/**
 * Turn the model's JSON into a draft. Every hole keeps its page and quote; quotes that cannot be
 * found in the PDF's own text are flagged, so the reviewer looks at those first.
 */
export function draftFromModel(
  text: string,
  file: string,
  pages: TextPage[],
  label: string,
): PatternDraft {
  const raw = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  let j: {
    name?: unknown;
    manufacturer?: unknown;
    partNumber?: unknown;
    holes?: unknown;
    notes?: unknown;
    warnings?: unknown;
  };
  try {
    j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    throw new Error(`${label} did not return readable JSON.`);
  }
  const warnings = Array.isArray(j.warnings)
    ? j.warnings.filter((w): w is string => typeof w === "string")
    : [];
  const pageText = new Map(
    pages.map((p) => [p.page, squash(p.lines.join(" "))]),
  );
  const findings: Finding[] = [];
  const holes: PatternHole[] = [];
  const provenance: HardwarePattern["provenance"] = [];
  let unmatched = 0;
  for (const h of Array.isArray(j.holes)
    ? (j.holes as Record<string, unknown>[])
    : []) {
    const hole: PatternHole = {
      x: num(h.x),
      y: num(h.y),
      diameter: num(h.diameter),
      depth: num(h.depth),
      face: FACE[String(h.face)] ?? 1,
    };
    holes.push(hole);
    const page = typeof h.page === "number" ? h.page : undefined;
    const quote = typeof h.quote === "string" ? h.quote.slice(0, 200) : "";
    const t =
      page !== undefined
        ? pageText.get(page)
        : [...pageText.values()].join(" ");
    const found = !!quote && !!t && t.includes(squash(quote));
    if (quote && t && !found) unmatched++;
    provenance.push({
      file,
      page,
      quote,
      note: `${label}: hole ${holes.length}${found ? "" : t ? " (quote not found in the PDF text; check the drawing)" : ""}`,
    });
    for (const k of ["diameter", "depth", "x", "y"] as const)
      if (Number.isFinite(hole[k]))
        findings.push({
          label: `Hole ${holes.length} ${k}`,
          value: hole[k],
          page,
          quote,
          used: true,
        });
  }
  if (!holes.length) warnings.push(`${label} found no holes on this sheet.`);
  if (unmatched)
    warnings.push(
      `${unmatched} quote(s) are not in the PDF's text layer (they may come from the drawing itself). Check those holes against the sheet.`,
    );
  if (
    holes.some((h) => ![h.x, h.y, h.diameter, h.depth].every(Number.isFinite))
  )
    warnings.push(
      "Some values were not printed on the sheet; fill them in before approving.",
    );
  const name =
    typeof j.name === "string" && j.name.trim()
      ? j.name.trim()
      : file.replace(/\.[^.]+$/, "");
  const pattern: HardwarePattern = {
    id: `pat-${Math.random().toString(36).slice(2, 10)}`,
    name,
    manufacturer: typeof j.manufacturer === "string" ? j.manufacturer : "",
    anchor: "edge-start",
    holes,
    status: "draft",
    source: "pdf-draft",
    provenance,
    notes: [
      typeof j.partNumber === "string" && j.partNumber
        ? `Part ${j.partNumber}`
        : "",
      typeof j.notes === "string" ? j.notes : "",
      `Drafted by ${label}`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
  return { pattern, findings, warnings };
}

export type AiTransport = (call: AiCall) => Promise<string>;

/** A drafter backed by a vision model. `images` are the rendered pages of the PDF. */
export function aiDrafter(
  provider: AiProviderId,
  model: string,
  transport: AiTransport,
): PatternDrafter {
  const label = `${providerInfo(provider).label} ${model}`;
  return {
    id: `ai-${provider}`,
    label,
    async draft(pages, file, images) {
      if (!images?.length) throw new Error("No page images to send.");
      const text = await transport({
        provider,
        model,
        prompt: DRAFT_PROMPT,
        images,
      });
      return draftFromModel(text, file, pages, label);
    },
  };
}

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
