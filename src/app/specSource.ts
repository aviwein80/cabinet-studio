import { loadPdfLib } from '@/cam/pdfVectors'
import { type AiProviderId, DEFAULT_AI, modelOf, type PageImage, providerInfo } from '@/core/hardware/aiProviders'
import { pdfTextPages } from '@/core/hardware/patternImport'
import type { SpecSource } from '@/core/spec/partSpec'
import type { ShopSettings } from '@/core/types'
import { backend } from './backend'
import { renderPdfPages } from './pdfImages'

export const SPEC_ACCEPT = '.pdf,application/pdf,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'

const isImage = (f: File) => /^image\/(png|jpe?g|webp)$/i.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name)

/** A photo or scan as one page image, scaled down to at most `max` pixels on its long side. */
async function imagePage(f: File, max = 2000): Promise<PageImage> {
  const bmp = await createImageBitmap(f)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * k)
  canvas.height = Math.round(bmp.height * k)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return { page: 1, mime: 'image/jpeg', base64: canvas.toDataURL('image/jpeg', 0.9).split(',')[1] }
}

/** Text layer and page images of a PDF, or the photo itself. */
export async function loadSpecSource(f: File): Promise<SpecSource> {
  if (isImage(f)) return { file: f.name, pages: [], images: [await imagePage(f)] }
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') throw new Error('Use a PDF, or a PNG, JPG or WebP photo or scan.')
  const bytes = new Uint8Array(await f.arrayBuffer())
  const lib = await loadPdfLib()
  const pages = await pdfTextPages(lib as never, bytes.slice())
  const images = await renderPdfPages(lib as never, bytes.slice())
  return { file: f.name, pages, images }
}

/** The chosen vision provider when its key is saved here; otherwise null (use the offline reader). */
export async function readyProvider(settings: ShopSettings): Promise<{ provider: AiProviderId; model: string; label: string } | null> {
  const ai = settings.ai ?? DEFAULT_AI
  if (ai.provider === 'off') return null
  const status = await backend.ai.status()
  if (!status[ai.provider]?.saved) return null
  const model = modelOf(ai, ai.provider)
  return { provider: ai.provider, model, label: `${providerInfo(ai.provider).label} ${model}` }
}

export const imageUrl = (i: PageImage) => `data:${i.mime};base64,${i.base64}`
