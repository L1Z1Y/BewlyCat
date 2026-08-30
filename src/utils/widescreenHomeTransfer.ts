import type {
  OpenWidescreenHomeVideoRequest,
  OpenWidescreenHomeVideoResponse,
  WidescreenHomeNavigationDisposition,
  WidescreenHomeTransferRecord,
} from '~/constants/widescreenHomeTransfer'
import {
  WIDESCREEN_HOME_TRANSFER_MESSAGE,
  WIDESCREEN_HOME_TRANSFER_PARAM,
  WIDESCREEN_HOME_TRANSFER_TTL_MS,
  WIDESCREEN_HOME_TRANSFER_VERSION,
} from '~/constants/widescreenHomeTransfer'
import type { ForYouState } from '~/stores/forYouStore'
import { sendMessage } from '~/utils/messaging'

let capturedTransferToken: string | undefined
let transferTokenCaptured = false
let snapshotRequest: Promise<ForYouState | undefined> | undefined

function isValidTransferToken(value: string): boolean {
  return /^[\w-]{8,128}$/.test(value)
}

function createTransferToken(): string {
  if (typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

function addTransferToken(url: string, token: string): string {
  const targetUrl = new URL(url, location.href)
  targetUrl.searchParams.set(WIDESCREEN_HOME_TRANSFER_PARAM, token)
  return targetUrl.toString()
}

export function captureWidescreenHomeTransferToken(): string | undefined {
  if (transferTokenCaptured)
    return capturedTransferToken

  transferTokenCaptured = true

  try {
    const url = new URL(location.href)
    const token = url.searchParams.get(WIDESCREEN_HOME_TRANSFER_PARAM)
    if (!token || !isValidTransferToken(token))
      return undefined

    capturedTransferToken = token
    url.searchParams.delete(WIDESCREEN_HOME_TRANSFER_PARAM)
    history.replaceState(history.state, '', url.toString())
  }
  catch (error) {
    console.warn('[BewlyCat] Failed to capture widescreen home transfer token:', error)
  }

  return capturedTransferToken
}

export async function takeCapturedWidescreenHomeSnapshot(): Promise<ForYouState | undefined> {
  const token = capturedTransferToken
  if (!token)
    return undefined

  snapshotRequest ??= sendMessage<string, WidescreenHomeTransferRecord | undefined>(
    WIDESCREEN_HOME_TRANSFER_MESSAGE.TAKE_SNAPSHOT,
    token,
  ).then((record) => {
    if (!record
      || record.version !== WIDESCREEN_HOME_TRANSFER_VERSION
      || record.token !== token
      || Date.now() - record.createdAt > WIDESCREEN_HOME_TRANSFER_TTL_MS) {
      return undefined
    }

    return record.snapshot
  }).catch((error) => {
    console.warn('[BewlyCat] Failed to restore widescreen home snapshot:', error)
    return undefined
  })

  return snapshotRequest
}

export async function openVideoWithWidescreenHomeSnapshot(
  url: string,
  snapshot: ForYouState,
  disposition: WidescreenHomeNavigationDisposition,
): Promise<void> {
  const token = createTransferToken()
  const targetUrl = addTransferToken(url, token)
  const request: OpenWidescreenHomeVideoRequest = {
    token,
    url: targetUrl,
    disposition,
    snapshot,
  }

  try {
    const response = await sendMessage<OpenWidescreenHomeVideoRequest, OpenWidescreenHomeVideoResponse>(
      WIDESCREEN_HOME_TRANSFER_MESSAGE.OPEN_VIDEO,
      request,
    )

    if (!response.opened)
      location.assign(response.url)
    return
  }
  catch (error) {
    console.error('[BewlyCat] Failed to prepare widescreen home navigation:', error)
  }

  if (disposition === 'current') {
    location.assign(targetUrl)
    return
  }

  const openedWindow = window.open(targetUrl, '_blank', 'noopener')
  if (!openedWindow && disposition === 'foreground')
    location.assign(targetUrl)
}
