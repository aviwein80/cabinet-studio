/** Material for a part from a solid file's properties (kept apart so screens can use it without the recognition code). */

/** The library material the file's "Material" property names (same name or code, any case). */
export function matchMaterial(props: Record<string, string | number>, materials: { id: string; name: string; code?: string }[] = []): string | null {
  const key = Object.keys(props).find((k) => /^material$/i.test(k.trim()))
  if (!key) return null
  const want = String(props[key]).trim().toLowerCase()
  return materials.find((m) => m.name.trim().toLowerCase() === want || (m.code ?? '').trim().toLowerCase() === want)?.id ?? null
}
