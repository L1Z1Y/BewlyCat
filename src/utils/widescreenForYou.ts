import { createApp } from 'vue'
import browser from 'webextension-polyfill'

import WidescreenForYou from '~/contentScripts/views/Home/components/WidescreenForYou.vue'
import { setupApp } from '~/logic/common-setup'
import RESET_BEWLY_CSS from '~/styles/reset.css?raw'
import { takeCapturedWidescreenHomeSnapshot } from '~/utils/widescreenHomeTransfer'

const MIRRORED_HOST_CLASSES = [
  'dark',
  'bewly-design',
  'forceDark',
  'bewly-video-dark-only',
  'disable-frosted-glass',
  'disable-shadow',
] as const

export interface WidescreenForYouMount {
  unmount: () => void
  hasOpenOverlay: () => boolean
}

interface MountOptions {
  loadingLabel: string
  loadFailedLabel: string
  retryLabel: string
  onRetry: () => void
}

function createStatusStyle() {
  const style = document.createElement('style')
  style.textContent = `
    :host {
      display: block;
      min-width: 0;
      color: var(--bewly-widescreen-text-primary, var(--bew-text-1));
    }

    .bewly-widescreen-home-status {
      display: flex;
      min-height: 160px;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: var(--bew-space-3, 12px);
      color: var(--bewly-widescreen-text-muted, var(--bew-text-3));
      font: 500 var(--bew-font-size-control, 13px) / var(--bew-line-height-control, 18px) var(--bew-font-family, sans-serif);
      text-align: center;
    }

    .bewly-widescreen-home-status__retry {
      min-width: 72px;
      min-height: 32px;
      padding: var(--bew-space-1, 4px) var(--bew-space-3, 12px);
      border: 1px solid var(--bewly-widescreen-sidebar-border, var(--bew-border-color));
      border-radius: var(--bew-interactive-radius, 8px);
      color: var(--bewly-widescreen-text-primary, var(--bew-text-1));
      background: var(--bewly-widescreen-control-bg, var(--bew-fill-1));
      cursor: pointer;
      font: inherit;
    }

    .bewly-widescreen-home-status__retry:hover {
      background: var(--bewly-widescreen-control-hover-bg, var(--bew-fill-2));
    }

    .bewly-widescreen-home-status__retry:focus-visible {
      outline: 2px solid var(--bew-theme-color, #00aeec);
      outline-offset: 2px;
    }
  `
  return style
}

function createStatus(label: string) {
  const status = document.createElement('div')
  status.className = 'bewly-widescreen-home-status'
  status.setAttribute('role', 'status')
  status.textContent = label
  return status
}

function renderLoadFailure(
  shadowRoot: ShadowRoot,
  loadFailedLabel: string,
  retryLabel: string,
  onRetry: () => void,
) {
  const status = createStatus(loadFailedLabel)
  const retryButton = document.createElement('button')
  retryButton.type = 'button'
  retryButton.className = 'bewly-widescreen-home-status__retry'
  retryButton.textContent = retryLabel
  retryButton.addEventListener('click', onRetry, { once: true })
  status.appendChild(retryButton)
  shadowRoot.replaceChildren(createStatusStyle(), status)
}

function mirrorThemeClasses(panel: HTMLElement) {
  const sync = () => {
    const bewlyHost = document.getElementById('bewly')
    for (const className of MIRRORED_HOST_CLASSES) {
      const enabled = document.documentElement.classList.contains(className)
        || bewlyHost?.classList.contains(className)
      panel.classList.toggle(className, Boolean(enabled))
    }
  }

  const observer = new MutationObserver(sync)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  const bewlyHost = document.getElementById('bewly')
  if (bewlyHost)
    observer.observe(bewlyHost, { attributes: true, attributeFilter: ['class'] })
  sync()

  return () => {
    observer.disconnect()
    for (const className of MIRRORED_HOST_CLASSES)
      panel.classList.remove(className)
  }
}

export async function mountWidescreenForYou(
  panel: HTMLElement,
  scrollViewport: HTMLElement,
  options: MountOptions,
): Promise<WidescreenForYouMount> {
  const initialState = await takeCapturedWidescreenHomeSnapshot()
  const shadowRoot = panel.shadowRoot ?? panel.attachShadow({ mode: 'open' })
  const stopMirroringTheme = mirrorThemeClasses(panel)
  const statusStyle = createStatusStyle()
  const loadingStatus = createStatus(options.loadingLabel)
  const resetStyle = document.createElement('style')
  const appStyle = document.createElement('link')
  const mountTarget = document.createElement('div')

  resetStyle.textContent = RESET_BEWLY_CSS
  appStyle.rel = 'stylesheet'
  appStyle.href = browser.runtime.getURL('dist/contentScripts/style.css')
  mountTarget.className = 'bewly-widescreen-home-app'
  mountTarget.style.visibility = 'hidden'
  shadowRoot.replaceChildren(resetStyle, appStyle, statusStyle, loadingStatus, mountTarget)

  let revealed = false
  let mounted = false
  const reveal = () => {
    if (revealed)
      return
    revealed = true
    loadingStatus.remove()
    statusStyle.remove()
    mountTarget.style.removeProperty('visibility')
  }
  appStyle.addEventListener('load', reveal, { once: true })
  appStyle.addEventListener('error', reveal, { once: true })
  const revealTimer = window.setTimeout(reveal, 1500)

  const app = createApp(WidescreenForYou, {
    scrollViewport,
    teleportTarget: mountTarget,
    initialState,
  })

  try {
    await setupApp(app)
    app.mount(mountTarget)
    mounted = true
  }
  catch (error) {
    window.clearTimeout(revealTimer)
    stopMirroringTheme()
    renderLoadFailure(
      shadowRoot,
      options.loadFailedLabel,
      options.retryLabel,
      options.onRetry,
    )
    throw error
  }

  return {
    unmount: () => {
      window.clearTimeout(revealTimer)
      stopMirroringTheme()
      if (mounted)
        app.unmount()
      shadowRoot.replaceChildren()
    },
    hasOpenOverlay: () => Boolean(
      shadowRoot.querySelector('.dialog, [role="dialog"], [aria-modal="true"]'),
    ),
  }
}
