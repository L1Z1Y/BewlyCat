<script setup lang="ts">
import type { BewlyAppProvider, SettingsNavigationTarget } from '~/composables/useAppProvider'
import { DrawerType, UndoForwardState } from '~/composables/useAppProvider'
import { useDark } from '~/composables/useDark'
import { OVERLAY_SCROLL_BAR_SCROLL } from '~/constants/globalEvents'
import type { WidescreenHomeNavigationDisposition } from '~/constants/widescreenHomeTransfer'
import ForYou from '~/contentScripts/views/Home/components/ForYou.vue'
import { HomeSubPage } from '~/contentScripts/views/Home/types'
import { AppPage } from '~/enums/appEnums'
import type { AppVideoElement, ForYouState, VideoElement } from '~/stores/forYouStore'
import { removeHttpFromUrl } from '~/utils/main'
import emitter from '~/utils/mitt'
import { openVideoWithWidescreenHomeSnapshot } from '~/utils/widescreenHomeTransfer'
import type { WidescreenSoftSwitchTarget } from '~/utils/widescreenSoftSwitch'
import { requestWidescreenSoftVideoSwitch } from '~/utils/widescreenSoftSwitch'

const props = defineProps<{
  scrollViewport: HTMLElement
  teleportTarget: HTMLElement
  initialState?: ForYouState
}>()

interface ForYouExposed {
  captureState: () => ForYouState
}

const { isDark } = useDark()
const activatedPage = ref<AppPage>(AppPage.Home)
const homeActivatedPage = ref<HomeSubPage>(HomeSubPage.ForYou)
const homeActivatedPageTouched = ref(false)
const isHomeTabSwitching = ref(false)
const mainAppRef = shallowRef(props.teleportTarget)
const scrollViewportRef = shallowRef<HTMLElement | null>(props.scrollViewport)
const reachTop = ref(props.scrollViewport.scrollTop === 0)
const scrollTop = ref(props.scrollViewport.scrollTop)
const searchFocusOverlayActive = ref(false)
const handleReachBottom = ref<(() => void) | undefined>()
const handlePageRefresh = ref<(() => void) | undefined>()
const canRefreshHomeSubPage = ref(true)
const handleUndoRefresh = ref<(() => void) | undefined>()
const handleForwardRefresh = ref<(() => void) | undefined>()
const undoForwardState = ref(UndoForwardState.Hidden)
const activeDrawer = ref<DrawerType>(DrawerType.None)
const pendingSettingsNavigation = ref<SettingsNavigationTarget>()
const forYouRef = shallowRef<ForYouExposed>()
const initialForYouState = props.initialState
  ? {
      ...props.initialState,
      // 宽屏首页使用侧栏外层滚动。数据先恢复，滚动位置由本组件
      // 按显示窗口中心的视频序号单独恢复。
      scrollTop: 0,
    }
  : undefined

let scrollRestorationCleanup: (() => void) | undefined

function getHomePanel(): HTMLElement | null {
  const rootNode = props.teleportTarget.getRootNode()
  return rootNode instanceof ShadowRoot && rootNode.host instanceof HTMLElement
    ? rootNode.host
    : null
}

function getVideoCards(): HTMLElement[] {
  return Array.from(props.teleportTarget.querySelectorAll<HTMLElement>(
    '.video-card-container--interactive[data-index]',
  ))
}

function captureCenteredVideoIndex(): number | undefined {
  const cards = getVideoCards()
  if (!cards.length)
    return undefined

  const viewportRect = props.scrollViewport.getBoundingClientRect()
  const viewportCenter = viewportRect.top + viewportRect.height / 2
  const cardPositions = cards.map(card => ({ card, rect: card.getBoundingClientRect() }))
  const cardAtCenter = cardPositions.find(({ rect }) => (
    rect.top <= viewportCenter && rect.bottom >= viewportCenter
  ))
  const centeredCard = cardAtCenter ?? cardPositions.reduce((closestCard, card) => {
    const closestDistance = Math.abs((closestCard.rect.top + closestCard.rect.bottom) / 2 - viewportCenter)
    const cardDistance = Math.abs((card.rect.top + card.rect.bottom) / 2 - viewportCenter)
    return cardDistance < closestDistance ? card : closestCard
  })
  const index = Number(centeredCard.card.dataset.index)

  return Number.isInteger(index) && index >= 0 ? index : undefined
}

function restoreCenteredVideo(index: number) {
  scrollRestorationCleanup?.()

  const panel = getHomePanel()
  if (!panel)
    return

  let stopped = false
  const timers = new Set<number>()
  const observedElements = [
    panel,
    props.scrollViewport.querySelector<HTMLElement>('.bewly-widescreen-sidebar-top'),
  ].filter((element): element is HTMLElement => Boolean(element))

  const applyScrollTop = () => {
    if (stopped)
      return

    const card = props.teleportTarget.querySelector<HTMLElement>(
      `.video-card-container--interactive[data-index="${index}"]`,
    )
    if (!card)
      return

    const viewportRect = props.scrollViewport.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const viewportCenter = viewportRect.top + viewportRect.height / 2
    const cardCenter = (cardRect.top + cardRect.bottom) / 2
    const targetScrollTop = Math.max(
      0,
      props.scrollViewport.scrollTop + cardCenter - viewportCenter,
    )
    if (Math.abs(props.scrollViewport.scrollTop - targetScrollTop) > 0.5)
      props.scrollViewport.scrollTo({ top: targetScrollTop })
  }

  const resizeObserver = new ResizeObserver(applyScrollTop)
  observedElements.forEach(element => resizeObserver.observe(element))

  const stop = () => {
    if (stopped)
      return
    stopped = true
    resizeObserver.disconnect()
    timers.forEach(timer => window.clearTimeout(timer))
    timers.clear()
    props.scrollViewport.removeEventListener('wheel', stop)
    props.scrollViewport.removeEventListener('touchstart', stop)
    props.scrollViewport.removeEventListener('pointerdown', stop)
    props.scrollViewport.removeEventListener('keydown', stop)
    if (scrollRestorationCleanup === stop)
      scrollRestorationCleanup = undefined
  }

  scrollRestorationCleanup = stop
  props.scrollViewport.addEventListener('wheel', stop, { passive: true })
  props.scrollViewport.addEventListener('touchstart', stop, { passive: true })
  props.scrollViewport.addEventListener('pointerdown', stop, { passive: true })
  props.scrollViewport.addEventListener('keydown', stop)

  for (const delay of [0, 80, 240, 600, 1200]) {
    const timer = window.setTimeout(() => {
      timers.delete(timer)
      applyScrollTop()
    }, delay)
    timers.add(timer)
  }

  const stopTimer = window.setTimeout(stop, 1500)
  timers.add(stopTimer)
}

function handleSidebarScroll() {
  const nextScrollTop = props.scrollViewport.scrollTop
  scrollTop.value = nextScrollTop
  reachTop.value = nextScrollTop === 0
  emitter.emit(OVERLAY_SCROLL_BAR_SCROLL, nextScrollTop)
}

function handleBackToTop(targetScrollTop = 0) {
  props.scrollViewport.scrollTo({
    top: targetScrollTop,
    behavior: 'smooth',
  })
}

async function haveScrollbar() {
  await nextTick()
  return props.scrollViewport.scrollHeight > props.scrollViewport.clientHeight
}

function setActiveDrawer(drawer: DrawerType) {
  activeDrawer.value = drawer
}

function getVideoUrl(item: VideoElement | AppVideoElement, event: MouseEvent) {
  const anchor = event.currentTarget
  if (anchor instanceof HTMLAnchorElement && anchor.href)
    return anchor.href

  if (item.displayData?.url)
    return item.displayData.url
  if (item.displayData?.bvid)
    return `https://www.bilibili.com/video/${item.displayData.bvid}`

  return item.item?.uri || ''
}

function navigateToVideo(url: string) {
  if (url)
    window.location.assign(url)
}

function getNavigationDisposition(event: MouseEvent): WidescreenHomeNavigationDisposition {
  if (event.ctrlKey || event.metaKey)
    return 'background'
  if (event.shiftKey)
    return 'foreground'

  return 'current'
}

/**
 * 卡片自带 bvid / aid / cid / 封面，够直接驱动 B 站的页面内换片，
 * 不需要额外请求视频详情。番剧、直播和跳转到站外的卡片不适用。
 */
function getSoftSwitchTarget(item: VideoElement | AppVideoElement, url: string): WidescreenSoftSwitchTarget | null {
  const displayData = item.displayData
  const bvid = displayData?.bvid?.trim()
  const aid = Number(displayData?.id)
  if (!bvid || !Number.isSafeInteger(aid) || aid <= 0)
    return null
  if (displayData?.goto && displayData.goto !== 'av')
    return null
  if (!/\/video\/(?:BV|av)/i.test(url))
    return null

  const cid = Number(displayData?.cid)
  const cover = displayData?.cover ? removeHttpFromUrl(displayData.cover) : ''

  return {
    url,
    bvid,
    aid,
    cid: Number.isSafeInteger(cid) && cid > 0 ? cid : undefined,
    coverUrl: cover ? `${cover}@1440w_810h_1c` : undefined,
  }
}

async function handleCardClick(item: VideoElement | AppVideoElement, event: MouseEvent) {
  const url = getVideoUrl(item, event)
  if (!url)
    return

  // 当前页打开时优先原地换片：宽屏外壳、本列表和滚动位置都保持不动。
  if (getNavigationDisposition(event) === 'current') {
    const softSwitchTarget = getSoftSwitchTarget(item, url)
    if (softSwitchTarget && await requestWidescreenSoftVideoSwitch(softSwitchTarget))
      return
  }

  const snapshot = forYouRef.value?.captureState()
  if (!snapshot) {
    navigateToVideo(url)
    return
  }

  snapshot.widescreenHomeCenteredVideoIndex = captureCenteredVideoIndex()
  await openVideoWithWidescreenHomeSnapshot(url, snapshot, getNavigationDisposition(event))
}

function openSettings(_target?: SettingsNavigationTarget) {
  // The compact widescreen feed does not expose the full settings surface.
}

const provider: BewlyAppProvider = {
  activatedPage,
  homeActivatedPage,
  homeActivatedPageTouched,
  isHomeTabSwitching,
  scrollViewportRef,
  reachTop,
  scrollTop,
  searchFocusOverlayActive,
  mainAppRef,
  handleReachBottom,
  handlePageRefresh,
  canRefreshHomeSubPage,
  handleUndoRefresh,
  handleForwardRefresh,
  undoForwardState,
  handleBackToTop,
  haveScrollbar,
  openIframeDrawer: navigateToVideo,
  activeDrawer,
  setActiveDrawer,
  pendingSettingsNavigation,
  openSettings,
}

provide<BewlyAppProvider>('BEWLY_APP', provider)

onMounted(async () => {
  props.scrollViewport.addEventListener('scroll', handleSidebarScroll, { passive: true })
  handleSidebarScroll()

  const centeredVideoIndex = props.initialState?.widescreenHomeCenteredVideoIndex
  if (typeof centeredVideoIndex === 'number' && Number.isInteger(centeredVideoIndex)) {
    await nextTick()
    restoreCenteredVideo(centeredVideoIndex)
  }
})

onUnmounted(() => {
  scrollRestorationCleanup?.()
  props.scrollViewport.removeEventListener('scroll', handleSidebarScroll)
})
</script>

<template>
  <div class="widescreen-for-you" :class="{ dark: isDark }">
    <ForYou
      ref="forYouRef"
      grid-layout="oneColumn"
      :initial-state="initialForYouState"
      :card-click-handler="handleCardClick"
    />
  </div>
</template>

<style scoped>
.widescreen-for-you {
  min-width: 0;
  color: var(--bew-text-1);
  background: transparent;
  font-family: var(--bew-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}
</style>
