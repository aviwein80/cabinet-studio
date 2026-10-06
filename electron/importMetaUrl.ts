/**
 * The Electron files are bundled as CommonJS, where `import.meta.url` does not exist; some
 * packages (the plugin sandbox's loader, M2.10) read it. The build points it here.
 */
import { pathToFileURL } from 'node:url'

export const importMetaUrl = pathToFileURL(__filename).href
