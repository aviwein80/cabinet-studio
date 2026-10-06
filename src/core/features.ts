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
  cam3dMprOutput: false,
  cam3d: true,
  camAdaptive: true,
  camSolids: true,
  camMore25d: true,
  cam25dMprOutput: false,
  camCadTools: true,
  nestAdditions: true,
  nestSharedOutput: false,
  nestBridgeOutput: false,
  nestFlipOutput: false,
  batchAdditions: true,
  batchMachinesOutput: false,
  plugins: true,
  scriptPostOutput: false,
  editedProgramOutput: false,
  camRelief: true,
}

export const featuresOf = (s: Pick<ShopSettings, 'features'> | undefined): FeatureFlags => ({ ...DEFAULT_FEATURES, ...(s?.features ?? {}) })
