import type { BottomBarAction } from '@chirag127/astro-chrome/BottomBar.astro'

/**
 * Per-app BottomBar actions for oriz · image-tools (mobile <768px).
 * Order: Home / Tools / Recent / Saved / Menu.
 */
export const bottomBarActions: BottomBarAction[] = [
  { icon: '⌂', label: 'Home', href: '/' },
  { icon: '⚒', label: 'Tools', href: '/tools/' },
  { icon: '↺', label: 'Recent', href: '/recent/' },
  { icon: '★', label: 'Saved', href: '/saved/' },
  { icon: '☰', label: 'Menu', href: '#sb-toggle' },
]
