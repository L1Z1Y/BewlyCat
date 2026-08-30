import type { Tabs } from 'webextension-polyfill'
import browser from 'webextension-polyfill'

import type {
  OpenWidescreenHomeVideoRequest,
  OpenWidescreenHomeVideoResponse,
  WidescreenHomeTransferRecord,
} from '~/constants/widescreenHomeTransfer'
import {
  WIDESCREEN_HOME_TRANSFER_MAX_RECORDS,
  WIDESCREEN_HOME_TRANSFER_MESSAGE,
  WIDESCREEN_HOME_TRANSFER_TTL_MS,
  WIDESCREEN_HOME_TRANSFER_VERSION,
} from '~/constants/widescreenHomeTransfer'
import { onMessage } from '~/utils/messaging'

interface Message {
  contentScriptQuery: string
  url?: string
  [key: string]: any
}

export enum TABS_MESSAGE {
  OPEN_LINK_IN_BACKGROUND = 'openLinkInBackground',
}

const WIDESCREEN_HOME_TRANSFER_STORAGE_KEY = 'widescreenHomeTransferSnapshots'
let widescreenHomeTransferQueue: Promise<void> = Promise.resolve()

function enqueueWidescreenHomeTransfer<T>(operation: () => Promise<T>): Promise<T> {
  const result = widescreenHomeTransferQueue.then(operation, operation)
  widescreenHomeTransferQueue = result.then(() => undefined, () => undefined)
  return result
}

function pruneWidescreenHomeTransferRecords(
  records: Record<string, WidescreenHomeTransferRecord>,
  now = Date.now(),
) {
  const activeRecords = Object.values(records)
    .filter(record => record.version === WIDESCREEN_HOME_TRANSFER_VERSION
      && now - record.createdAt <= WIDESCREEN_HOME_TRANSFER_TTL_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, WIDESCREEN_HOME_TRANSFER_MAX_RECORDS)

  return Object.fromEntries(activeRecords.map(record => [record.token, record]))
}

async function readWidescreenHomeTransferRecords() {
  const stored = await browser.storage.session.get(WIDESCREEN_HOME_TRANSFER_STORAGE_KEY)
  const records = stored[WIDESCREEN_HOME_TRANSFER_STORAGE_KEY]
  if (!records || typeof records !== 'object')
    return {} as Record<string, WidescreenHomeTransferRecord>

  return records as Record<string, WidescreenHomeTransferRecord>
}

async function saveAndOpenWidescreenHomeVideo(
  request: OpenWidescreenHomeVideoRequest,
  sender?: browser.Runtime.MessageSender,
): Promise<OpenWidescreenHomeVideoResponse> {
  const transferRecord: WidescreenHomeTransferRecord = {
    version: WIDESCREEN_HOME_TRANSFER_VERSION,
    token: request.token,
    createdAt: Date.now(),
    snapshot: request.snapshot,
  }
  let snapshotSaved = false
  try {
    const records = pruneWidescreenHomeTransferRecords(await readWidescreenHomeTransferRecords())
    records[request.token] = transferRecord
    const nextRecords = pruneWidescreenHomeTransferRecords(records)
    try {
      await browser.storage.session.set({ [WIDESCREEN_HOME_TRANSFER_STORAGE_KEY]: nextRecords })
      snapshotSaved = true
    }
    catch (error) {
      // A long-scrolled feed can make several retained snapshots exceed the
      // session quota. Prefer the current navigation over older snapshots.
      await browser.storage.session.set({
        [WIDESCREEN_HOME_TRANSFER_STORAGE_KEY]: { [request.token]: transferRecord },
      })
      snapshotSaved = true
      console.warn('[BewlyCat] Replaced older widescreen home snapshots after storage pressure:', error)
    }
  }
  catch (error) {
    console.error('[BewlyCat] Failed to save widescreen home snapshot:', error)
  }

  if (request.disposition === 'current') {
    return {
      url: request.url,
      opened: false,
      snapshotSaved,
    }
  }

  const createProps: Tabs.CreateCreatePropertiesType = {
    url: request.url,
    active: request.disposition === 'foreground',
  }
  if (sender?.tab?.windowId !== undefined)
    createProps.windowId = sender.tab.windowId
  if (sender?.tab?.index !== undefined)
    createProps.index = sender.tab.index + 1

  await browser.tabs.create(createProps)
  return {
    url: request.url,
    opened: true,
    snapshotSaved,
  }
}

async function takeWidescreenHomeSnapshot(token: string) {
  const records = pruneWidescreenHomeTransferRecords(await readWidescreenHomeTransferRecords())
  const record = records[token]
  delete records[token]
  try {
    await browser.storage.session.set({ [WIDESCREEN_HOME_TRANSFER_STORAGE_KEY]: records })
  }
  catch (error) {
    console.warn('[BewlyCat] Failed to consume widescreen home snapshot:', error)
  }
  return record
}

async function handleMessage(data: Message, sender?: browser.Runtime.MessageSender) {
  if (data.contentScriptQuery === TABS_MESSAGE.OPEN_LINK_IN_BACKGROUND) {
    // 处理以 // 开头的 URL
    const url = data.url?.startsWith('//') ? `https:${data.url}` : data.url
    let windowId = sender?.tab?.windowId
    let index = sender?.tab?.index

    if (windowId === undefined || index === undefined) {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true })
      windowId ??= activeTab?.windowId
      index ??= activeTab?.index
    }

    const createProps: Tabs.CreateCreatePropertiesType = {
      url,
      active: false,
    }

    if (windowId !== undefined) {
      createProps.windowId = windowId
    }

    if (index !== undefined) {
      createProps.index = index + 1
    }

    return browser.tabs.create(createProps)
  }
}

export function setupTabMsgListeners() {
  onMessage(TABS_MESSAGE.OPEN_LINK_IN_BACKGROUND, handleMessage)
  onMessage<OpenWidescreenHomeVideoRequest, OpenWidescreenHomeVideoResponse>(
    WIDESCREEN_HOME_TRANSFER_MESSAGE.OPEN_VIDEO,
    (request, sender) => enqueueWidescreenHomeTransfer(() => saveAndOpenWidescreenHomeVideo(request, sender)),
  )
  onMessage<string, WidescreenHomeTransferRecord | undefined>(
    WIDESCREEN_HOME_TRANSFER_MESSAGE.TAKE_SNAPSHOT,
    token => enqueueWidescreenHomeTransfer(() => takeWidescreenHomeSnapshot(token)),
  )
}
