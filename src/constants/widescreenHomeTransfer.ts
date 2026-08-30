import type { ForYouState } from '~/stores/forYouStore'

export const WIDESCREEN_HOME_TRANSFER_PARAM = 'bewly_widescreen_home'
export const WIDESCREEN_HOME_TRANSFER_VERSION = 2
export const WIDESCREEN_HOME_TRANSFER_TTL_MS = 30 * 60 * 1000
export const WIDESCREEN_HOME_TRANSFER_MAX_RECORDS = 8

export type WidescreenHomeNavigationDisposition = 'current' | 'foreground' | 'background'

export interface WidescreenHomeTransferRecord {
  version: typeof WIDESCREEN_HOME_TRANSFER_VERSION
  token: string
  createdAt: number
  snapshot: ForYouState
}

export interface OpenWidescreenHomeVideoRequest {
  token: string
  url: string
  disposition: WidescreenHomeNavigationDisposition
  snapshot: ForYouState
}

export interface OpenWidescreenHomeVideoResponse {
  url: string
  opened: boolean
  snapshotSaved: boolean
}

export enum WIDESCREEN_HOME_TRANSFER_MESSAGE {
  OPEN_VIDEO = 'openWidescreenHomeVideo',
  TAKE_SNAPSHOT = 'takeWidescreenHomeSnapshot',
}
