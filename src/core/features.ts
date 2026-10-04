import type { FeatureFlags, ShopSettings } from './types'

/** Every custom-part screen is on; writing custom-part machining into N-200 files is off. */
export const DEFAULT_FEATURES: FeatureFlags = {
  camCad: true,
  camImport: true,
  camMachining: true,
  camRules: true,
  camParametric: true,
  camNesting: true,
  camBatch: true,
  camBackplot: true,
  hardwarePatterns: true,
  camMprOutput: false,
}

export const featuresOf = (s: Pick<ShopSettings, 'features'> | undefined): FeatureFlags => ({ ...DEFAULT_FEATURES, ...(s?.features ?? {}) })
