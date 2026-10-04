import type { PageImage } from "@/core/hardware/aiProviders";

interface RenderLib {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean }): {
    promise: Promise<{
      numPages: number;
      getPage(
        n: number,
      ): Promise<{
        getViewport(o: { scale: number }): { width: number; height: number };
        render(o: {
          canvasContext: CanvasRenderingContext2D;
          viewport: unknown;
          canvas?: HTMLCanvasElement;
        }): { promise: Promise<void> };
      }>;
    }>;
  };
}

/** Render the first pages of a PDF to PNG, about `width` pixels wide, for a vision model. */
export async function renderPdfPages(
  lib: RenderLib,
  data: Uint8Array,
  opts: { maxPages?: number; width?: number } = {},
): Promise<PageImage[]> {
  const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
  const out: PageImage[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, opts.maxPages ?? 6); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: (opts.width ?? 1600) / base.width,
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    out.push({
      page: n,
      mime: "image/png",
      base64: canvas.toDataURL("image/png").split(",")[1],
    });
  }
  return out;
}
