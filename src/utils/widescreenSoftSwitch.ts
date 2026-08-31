/**
 * Bewly 宽屏「首页」点击视频时的页面内换片链路。
 *
 * B 站视频页自身就支持不重载文档地换视频（自动连播、推荐跳转走的就是这条路），
 * 对应根组件下的 handleVideoRoute + switchVideo。这两个方法只存在于页面主世界，
 * 因此内容脚本通过既有的 postMessage 桥转交给 `src/inject/index.ts` 执行。
 */

const SOFT_SWITCH_REQUEST_MESSAGE = 'BEWLY_SOFT_SWITCH_VIDEO'
const SOFT_SWITCH_RESULT_MESSAGE = 'BEWLY_SOFT_SWITCH_VIDEO_RESULT'
/** 主世界只做同步调用，超过这个时间基本可判定注入脚本没接上。 */
const SOFT_SWITCH_BRIDGE_TIMEOUT = 400

export interface WidescreenSoftSwitchTarget {
  /** 目标视频页完整 URL，回退整页跳转时使用。 */
  url: string
  bvid: string
  aid: number
  cid?: number
  /** 换片过程中盖住播放器的封面图。 */
  coverUrl?: string
}

export type WidescreenSoftSwitchDriver = (target: WidescreenSoftSwitchTarget) => Promise<boolean>

let driver: WidescreenSoftSwitchDriver | undefined
let requestSeed = 0
let bridgeListenerInstalled = false
const pendingRequests = new Map<number, (ok: boolean) => void>()

function settleRequest(requestId: number, ok: boolean) {
  const resolve = pendingRequests.get(requestId)
  if (!resolve)
    return

  pendingRequests.delete(requestId)
  resolve(ok)
}

function ensureBridgeListener() {
  if (bridgeListenerInstalled)
    return

  bridgeListenerInstalled = true
  window.addEventListener('message', (event) => {
    if (event.source !== window)
      return

    const payload = event.data
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      return
    if (payload.type !== SOFT_SWITCH_RESULT_MESSAGE)
      return

    const requestId = Number(payload.data?.requestId)
    if (!Number.isSafeInteger(requestId))
      return

    settleRequest(requestId, payload.data?.ok === true)
  })
}

/**
 * 请求主世界执行一次页面内换片。注入脚本缺失或 B 站内部接口变动时返回 false，
 * 调用方需要回退到整页跳转。
 */
export function sendWidescreenSoftSwitchToPage(target: WidescreenSoftSwitchTarget): Promise<boolean> {
  ensureBridgeListener()

  const requestId = ++requestSeed
  return new Promise<boolean>((resolve) => {
    pendingRequests.set(requestId, resolve)
    window.setTimeout(() => settleRequest(requestId, false), SOFT_SWITCH_BRIDGE_TIMEOUT)

    try {
      window.postMessage({
        type: SOFT_SWITCH_REQUEST_MESSAGE,
        data: {
          requestId,
          bvid: target.bvid,
          aid: target.aid,
          cid: target.cid,
          p: 1,
        },
      }, window.location.origin)
    }
    catch (error) {
      console.warn('[BewlyCat] Failed to post widescreen soft switch request:', error)
      settleRequest(requestId, false)
    }
  })
}

/**
 * 由 `src/contentScripts/index.ts` 注册。换片前后的路由记账依赖那里的闭包状态，
 * 所以用注册回调而不是让视图层反向依赖内容脚本入口。
 */
export function registerWidescreenSoftSwitchDriver(next: WidescreenSoftSwitchDriver) {
  driver = next
}

export function requestWidescreenSoftVideoSwitch(target: WidescreenSoftSwitchTarget): Promise<boolean> {
  if (!driver)
    return Promise.resolve(false)

  return driver(target)
}
