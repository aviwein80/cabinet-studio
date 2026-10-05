import { FileText } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** Third-party libraries that ship as their own files or need a notice in the app. */
const COMPONENTS: { name: string; use: string; licence: string; file?: string }[] = [
  { name: 'occt-import-js 0.0.23 with Open CASCADE Technology', use: 'Reads STEP, IGES and BREP solid models. Loaded only when a solid file is opened; shipped as separate, replaceable files.', licence: 'LGPL-2.1', file: 'vendor/occt-import-js/license.occt.txt' },
  { name: 'meshoptimizer 1.3.0', use: 'Simplifies imported 3D meshes.', licence: 'MIT' },
  { name: 'Clipper2 (clipper2-ts)', use: '2D offsets and booleans.', licence: 'BSL-1.0' },
  { name: 'three.js, React, pdf.js, jsPDF, JSZip and others', use: 'Screens, 3D view, PDF and file handling.', licence: 'MIT / Apache-2.0' },
]

/** About: version and third-party notices (the full text of THIRD_PARTY_NOTICES.md and the LGPL). */
export function AboutSection() {
  const [shown, setShown] = useState<{ title: string; text: string } | null>(null)
  const open = async (title: string, file: string) => {
    try {
      const r = await fetch(file)
      setShown({ title, text: r.ok ? await r.text() : `Could not open ${file} (${r.status}).` })
    } catch (e) {
      setShown({ title, text: `Could not open ${file}: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  return (
    <section className="mx-auto mt-8 flex max-w-4xl flex-col gap-3" aria-label="About">
      <div>
        <h2 className="text-base font-semibold tracking-tight">About Cabinet Studio</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Cabinet design to woodWOP MPR nesting for the CENTATEQ N-200. Third-party software used by the app and its licences:</p>
      </div>
      <ul className="flex flex-col divide-y rounded-lg border text-sm">
        {COMPONENTS.map((c) => (
          <li key={c.name} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="font-medium">{c.name}</span>
            <Badge variant="outline">{c.licence}</Badge>
            <span className="basis-full text-xs text-muted-foreground">{c.use}</span>
            {c.file && (
              <Button size="xs" variant="ghost" onClick={() => void open(`${c.name}: licence`, c.file!)}>
                <FileText /> Licence text
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div>
        <Button size="sm" variant="outline" onClick={() => void open('Third-party notices', 'THIRD_PARTY_NOTICES.md')}>
          <FileText /> Third-party notices
        </Button>
      </div>
      <Dialog open={!!shown} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{shown?.title}</DialogTitle>
            <DialogDescription>Shipped with the app.</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-[11px] leading-snug whitespace-pre-wrap">{shown?.text}</pre>
        </DialogContent>
      </Dialog>
    </section>
  )
}
