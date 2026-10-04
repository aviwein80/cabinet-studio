import { describe, expect, it } from "vitest";
import {
  AI_PROVIDERS,
  type AiCall,
  buildRequest,
  callProvider,
  modelOf,
  responseText,
} from "@/core/hardware/aiProviders";
import { aiDrafter, draftFromModel } from "@/core/spec/hardwareSpec";
import { approvePattern, savePattern } from "@/core/hardware/patterns";
import { defaultAppData } from "@/core/defaults";

const img = { page: 2, mime: "image/png", base64: "iVBORw0KGgo=" };
const call = (provider: AiCall["provider"]): AiCall => ({
  provider,
  model: "m-1",
  prompt: "read it",
  images: [img],
});

const MODEL_JSON = JSON.stringify({
  name: "Grass Tiomos 110°",
  manufacturer: "Grass",
  partNumber: "F028138441",
  holes: [
    {
      x: 0,
      y: 22.5,
      diameter: 35,
      depth: 13,
      face: "top",
      page: 2,
      quote: "Ø35 x 13",
    },
    {
      x: -22.5,
      y: null,
      diameter: 8,
      depth: 11,
      face: "top",
      page: 2,
      quote: "dowel holes 45 mm",
    },
  ],
  notes: "",
  warnings: ["Boring distance 3 to 7 mm; picked none."],
});

describe("Spec-sheet reader providers", () => {
  it("offers OpenAI, Anthropic, Google and xAI, each with a default vision model", () => {
    expect(AI_PROVIDERS.map((p) => p.id)).toEqual([
      "openai",
      "anthropic",
      "google",
      "xai",
    ]);
    expect(
      AI_PROVIDERS.every(
        (p) => p.defaultModel && p.host.startsWith("https://"),
      ),
    ).toBe(true);
    expect(modelOf({ provider: "xai", models: { xai: " " } }, "xai")).toBe(
      "grok-4",
    );
    expect(
      modelOf({ provider: "google", models: { google: "gemini-x" } }, "google"),
    ).toBe("gemini-x");
  });

  it("builds each provider request with the key in its header and the page image attached", () => {
    const o = buildRequest(call("openai"), "K1");
    expect(o.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(o.headers.authorization).toBe("Bearer K1");
    const ob = JSON.parse(o.body);
    expect(ob.model).toBe("m-1");
    expect(ob.response_format).toEqual({ type: "json_object" });
    expect(ob.messages[0].content[1].image_url.url).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );

    const x = buildRequest(call("xai"), "K4");
    expect(x.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(x.headers.authorization).toBe("Bearer K4");
    expect(JSON.parse(x.body).messages[0].content[1].type).toBe("image_url");

    const a = buildRequest(call("anthropic"), "K2");
    expect(a.url).toBe("https://api.anthropic.com/v1/messages");
    expect(a.headers["x-api-key"]).toBe("K2");
    expect(a.headers["anthropic-version"]).toBeTruthy();
    const ab = JSON.parse(a.body);
    expect(ab.messages[0].content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
    });

    const g = buildRequest(call("google"), "K3");
    expect(g.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/m-1:generateContent",
    );
    expect(g.headers["x-goog-api-key"]).toBe("K3");
    expect(g.url).not.toContain("K3");
    expect(JSON.parse(g.body).contents[0].parts[1].inline_data.mime_type).toBe(
      "image/png",
    );
    [o, x, a, g].forEach((r, i) =>
      expect(r.body).not.toContain(["K1", "K4", "K2", "K3"][i]),
    );
  });

  it("reads the model text out of each response shape and reports provider errors", () => {
    expect(
      responseText(
        "openai",
        200,
        JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }),
      ),
    ).toBe('{"a":1}');
    expect(
      responseText(
        "xai",
        200,
        JSON.stringify({ choices: [{ message: { content: "x" } }] }),
      ),
    ).toBe("x");
    expect(
      responseText(
        "anthropic",
        200,
        JSON.stringify({ content: [{ type: "text", text: "hi" }] }),
      ),
    ).toBe("hi");
    expect(
      responseText(
        "google",
        200,
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "g" }] } }],
        }),
      ),
    ).toBe("g");
    expect(() =>
      responseText(
        "anthropic",
        401,
        JSON.stringify({ error: { message: "invalid x-api-key" } }),
      ),
    ).toThrow("Anthropic error 401: invalid x-api-key");
    expect(() => responseText("google", 502, "<html>")).toThrow("non-JSON");
  });

  it("turns the model JSON into a draft that keeps nulls empty and flags quotes not in the PDF text", () => {
    const d = draftFromModel(
      "```json\n" + MODEL_JSON + "\n```",
      "grass.pdf",
      [{ page: 2, lines: ["Boring pattern", "Ø35 x 13"] }],
      "Google Gemini m-1",
    );
    expect(d.pattern).toMatchObject({
      status: "draft",
      source: "pdf-draft",
      name: "Grass Tiomos 110°",
      manufacturer: "Grass",
    });
    expect(d.pattern.holes[0]).toEqual({
      x: 0,
      y: 22.5,
      diameter: 35,
      depth: 13,
      face: 1,
    });
    expect(Number.isNaN(d.pattern.holes[1].y)).toBe(true);
    expect(d.pattern.notes).toContain("F028138441");
    expect(d.pattern.provenance[0]).toMatchObject({
      page: 2,
      quote: "Ø35 x 13",
    });
    expect(d.pattern.provenance[1].note).toContain("quote not found");
    expect(d.warnings).toContain("Boring distance 3 to 7 mm; picked none.");
    expect(d.warnings.some((w) => w.includes("not in the PDF"))).toBe(true);
    expect(() =>
      draftFromModel("sorry, I cannot", "x.pdf", [], "OpenAI"),
    ).toThrow("did not return readable JSON");
  });

  it("drafts through any provider behind one interface, and the result still needs approval", async () => {
    for (const p of AI_PROVIDERS) {
      const seen: AiCall[] = [];
      const drafter = aiDrafter(p.id, p.defaultModel, async (c) => {
        seen.push(c);
        return MODEL_JSON;
      });
      const d = await drafter.draft(
        [{ page: 2, lines: ["Ø35 x 13"] }],
        "grass.pdf",
        [img],
      );
      expect(seen[0]).toMatchObject({
        provider: p.id,
        model: p.defaultModel,
        images: [img],
      });
      expect(d.pattern.status).toBe("draft");
      const lib = structuredClone(defaultAppData().library);
      expect(savePattern(lib, d.pattern).ok).toBe(false);
      expect(
        approvePattern(
          d.pattern,
          { reviewer: "Avi", checked: true },
          new Date(),
        ).errors,
      ).toContain("Hole 2: position is missing.");
    }
    await expect(
      aiDrafter("openai", "m", async () => "{}").draft([], "a.pdf"),
    ).rejects.toThrow("No page images");
  });

  it("calls the provider over HTTPS with the stored key, and refuses without one", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    expect(await callProvider(call("anthropic"), "sk-ant-1", fake)).toBe("ok");
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe(
      "sk-ant-1",
    );
    await expect(callProvider(call("xai"), "", fake)).rejects.toThrow(
      "No xAI Grok API key",
    );
  });

  it("never puts keys in the shop settings", () => {
    const d = defaultAppData();
    d.settings.ai = {
      provider: "anthropic",
      models: { anthropic: "claude-x" },
    };
    expect(JSON.stringify(d)).not.toMatch(/sk-|api[_-]?key/i);
  });
});
