/**
 * Text posts for a part (M2.10b, PST-02): the built-in template post and plugins' script posts,
 * both on the one post input (`postInput` in `src/cam/post.ts`). The woodWOP writer stays the
 * built-in path for the N-200; text posts are for other machines only, and write programs only
 * when `checkTextPost` (the export checker) finds nothing.
 */
import { generatePart, type Toolpath } from '../toolpath'
import { postInput, runTemplate, type PostInput } from '../post'
import type { CamPart } from '../types'
import { dataFor, machineSetup } from '@/core/machines'
import { featuresOf } from '@/core/features'
import { runJob } from '@/core/pipeline'
import type { AppData, Job } from '@/core/types'
import { checkTextPost, type Issue } from '@/core/validator'
import { PluginError, type PluginHost } from './host'

/** Largest program a script post may return. */
export const MAX_POST_TEXT = 50 * 1024 * 1024

export function checkPostText(text: unknown, name: string): string {
  if (typeof text !== 'string') throw new PluginError(`${name} did not return text.`)
  if (text.length > MAX_POST_TEXT) throw new PluginError(`${name} returned more than 50 MB.`)
  if (text.includes('\0')) throw new PluginError(`${name} returned text with a NUL character.`)
  return text
}

/** Run a plugin's script post in its sandbox. */
export async function runScriptPost(host: PluginHost, postId: string, input: PostInput): Promise<{ ext: string; text: string }> {
  const def = host.contributes.posts.find((p) => p.id === postId)
  if (!def) throw new PluginError(`${host.record.manifest.name} has no post "${postId}".`)
  return { ext: def.ext, text: checkPostText(await host.call('post', postId, '', input), def.name) }
}

export interface PartPostPlan {
  machineName: string
  post: NonNullable<ReturnType<typeof machineSetup>>['post']
  toolpaths: Toolpath[]
  input: PostInput
  /** Export-checker results for writing this part through the post (errors block writing). */
  issues: Issue[]
  /** True when a program may be written. */
  writable: boolean
  /** The template post's text, straight away (script posts run in their sandbox). */
  templateText?: { ext: string; text: string }
}

/**
 * Everything needed to show (and maybe write) a part's program through a machine's text post: the
 * toolpaths made with that machine's own tools, the post input, and the export checks for that
 * machine (the part as a one-part job, then the text-post rules).
 */
export function planPartPost(data: AppData, machineId: string, part: CamPart): PartPostPlan {
  const setup = machineSetup(data, machineId)
  if (!setup) throw new Error(`Machine "${machineId}" is not in the machine list.`)
  const d = dataFor(data, machineId)
  const toolpaths = generatePart(part, d.machine, undefined, undefined, true).filter((t) => t.moves.length)
  const input = postInput(part.name, toolpaths, { part: { length: part.length, width: part.width, thickness: part.thickness } })
  const at = '2026-01-01T00:00:00.000Z'
  const job: Job = { id: `post-${part.id}`, number: 'POST', name: part.name, customer: '', notes: '', createdAt: at, updatedAt: at, cabinets: [], camParts: [{ ...part, qty: 1 }] }
  const jobIssues = setup.post.kind === 'woodwop-mpr' ? [] : runJob(job, d).issues.filter((i) => i.severity === 'error')
  const plugin = setup.post.kind === 'script' ? ((data.plugins ?? []).find((p) => p.id === (setup.post as { plugin: string }).plugin) ?? null) : null
  const issues = checkTextPost(setup, { switchOn: featuresOf(data.settings).scriptPostOutput, plugin, toolpaths, issues: jobIssues })
  return {
    machineName: setup.name,
    post: setup.post,
    toolpaths,
    input,
    issues,
    writable: setup.post.kind !== 'woodwop-mpr' && !issues.some((i) => i.severity === 'error'),
    ...(setup.post.kind === 'template' ? { templateText: runTemplate(setup.post, input) } : {}),
  }
}
