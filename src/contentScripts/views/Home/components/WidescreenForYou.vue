<script setup lang="ts">
import type { BewlyAppProvider, SettingsNavigationTarget } from '~/composables/useAppProvider'
import { DrawerType, UndoForwardState } from '~/composables/useAppProvider'
import { useDark } from '~/composables/useDark'
import { OVERLAY_SCROLL_BAR_SCROLL } from '~/constants/globalEvents'
import ForYou from '~/contentScripts/views/Home/components/ForYou.vue'
import { HomeSubPage } from '~/contentScripts/views/Home/types'
import { AppPage } from '~/enums/appEnums'
import type { AppVideoElement, VideoElement } from '~/stores/forYouStore'
import emitter from '~/utils/mitt'

const props = defineProps<{
  scrollViewport: HTMLElement
  teleportTarget: HTMLElement
}>()

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

function handleCardClick(item: VideoElement | AppVideoElement, event: MouseEvent) {
  const url = getVideoUrl(item, event)
  if (!url)
    return

  if (event.ctrlKey || event.metaKey) {
    window.open(url, '_blank', 'noopener')
    return
  }

  navigateToVideo(url)
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

onMounted(() => {
  props.scrollViewport.addEventListener('scroll', handleSidebarScroll, { passive: true })
  handleSidebarScroll()
})

onUnmounted(() => {
  props.scrollViewport.removeEventListener('scroll', handleSidebarScroll)
})
</script>

<template>
  <div class="widescreen-for-you" :class="{ dark: isDark }">
    <ForYou grid-layout="oneColumn" :card-click-handler="handleCardClick" />
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
