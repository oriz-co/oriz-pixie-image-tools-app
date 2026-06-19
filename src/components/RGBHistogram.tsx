/*
 * RGBHistogram — the signature component for image.oriz.in.
 *
 * Per design-briefs/oriz-image-tools.md §5:
 *   - Three channels (R, G, B) stacked in one SVG.
 *   - Each channel is a filled path sampled at 256 buckets.
 *   - Alpha 0.5 so overlapping regions composite naturally.
 *   - Stroke 0. Background transparent.
 *   - Same component is reused for the home-page footer pulse and the
 *     tool-page live strip.
 *
 * The hook `useImageHistogram(bitmap)` walks pixel data once via OffscreenCanvas,
 * downsamples to ≤512² for cost, and produces three 256-bucket Uint32Arrays.
 * The walk is debounced 33ms (~30fps) so dragging a slider doesn't choke the
 * main thread.
 *
 * On the home page, with no real bitmap loaded, the strip pulses with a
 * synthetic sin(t)-driven curve so the page never looks dead. Once a tool
 * has run, the last processed bitmap (or its histogram) is cached in
 * sessionStorage as 256×3 Uint8 buckets.
 */
import { useEffect, useRef, useState } from 'react'

const SESSION_KEY = 'oriz:imageTools:lastHistogram'

export type Histogram = {
  r: Uint32Array
  g: Uint32Array
  b: Uint32Array
  /** Max bucket value across all 3 channels — used to normalise the SVG paths. */
  max: number
}

const emptyHistogram = (): Histogram => ({
  r: new Uint32Array(256),
  g: new Uint32Array(256),
  b: new Uint32Array(256),
  max: 1,
})

/**
 * Compute a 3-channel histogram from an ImageBitmap or HTMLCanvasElement.
 * Downsamples to <=512² before walking pixels.
 */
export function computeHistogram(
  source: ImageBitmap | HTMLCanvasElement | HTMLImageElement,
): Histogram {
  let w = 0
  let h = 0
  if (source instanceof HTMLCanvasElement) {
    w = source.width
    h = source.height
  } else if (source instanceof HTMLImageElement) {
    w = source.naturalWidth
    h = source.naturalHeight
  } else {
    w = source.width
    h = source.height
  }
  if (w === 0 || h === 0) return emptyHistogram()

  // Downsample to <=512² so the walk is cheap even on huge images.
  const scale = Math.min(1, 512 / Math.max(w, h))
  const dw = Math.max(1, Math.round(w * scale))
  const dh = Math.max(1, Math.round(h * scale))

  const offCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(dw, dh)
      : Object.assign(document.createElement('canvas'), { width: dw, height: dh })
  const ctx = offCanvas.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx) return emptyHistogram()
  // drawImage accepts ImageBitmap, canvas, or img.
  ;(ctx as CanvasRenderingContext2D).drawImage(source as CanvasImageSource, 0, 0, dw, dh)
  const img = ctx.getImageData(0, 0, dw, dh)
  const data = img.data
  const r = new Uint32Array(256)
  const g = new Uint32Array(256)
  const b = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) {
    r[data[i]]++
    g[data[i + 1]]++
    b[data[i + 2]]++
  }
  let max = 1
  for (let k = 0; k < 256; k++) {
    if (r[k] > max) max = r[k]
    if (g[k] > max) max = g[k]
    if (b[k] > max) max = b[k]
  }
  return { r, g, b, max }
}

/** Synthetic sin-driven histogram for the empty home-page strip. */
function syntheticHistogram(t: number): Histogram {
  const r = new Uint32Array(256)
  const g = new Uint32Array(256)
  const b = new Uint32Array(256)
  for (let k = 0; k < 256; k++) {
    const x = k / 255
    r[k] = Math.round(800 * (0.5 + 0.5 * Math.sin(8 * x + t)) * Math.exp(-3 * (x - 0.35) ** 2))
    g[k] = Math.round(800 * (0.5 + 0.5 * Math.sin(7 * x + t * 1.1 + 1.0)) * Math.exp(-3 * (x - 0.5) ** 2))
    b[k] = Math.round(800 * (0.5 + 0.5 * Math.sin(6 * x + t * 0.9 + 2.0)) * Math.exp(-3 * (x - 0.65) ** 2))
  }
  let max = 1
  for (let k = 0; k < 256; k++) {
    if (r[k] > max) max = r[k]
    if (g[k] > max) max = g[k]
    if (b[k] > max) max = b[k]
  }
  return { r, g, b, max }
}

/**
 * React hook that watches a source bitmap and returns the latest histogram.
 * Returns a synthetic pulsing curve when source is null (used on the home
 * page) or when sessionStorage has no cached data yet.
 *
 * Debounced at ~33ms (30fps).
 */
export function useImageHistogram(
  source: ImageBitmap | HTMLCanvasElement | HTMLImageElement | null,
): Histogram {
  const [hist, setHist] = useState<Histogram>(() => {
    // Try to restore from sessionStorage on first paint.
    if (typeof sessionStorage === 'undefined') return emptyHistogram()
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      if (!raw) return emptyHistogram()
      const parsed = JSON.parse(raw) as { r: number[]; g: number[]; b: number[]; max: number }
      return {
        r: Uint32Array.from(parsed.r),
        g: Uint32Array.from(parsed.g),
        b: Uint32Array.from(parsed.b),
        max: parsed.max || 1,
      }
    } catch {
      return emptyHistogram()
    }
  })

  // When a real source is provided, debounce + recompute.
  useEffect(() => {
    if (!source) return
    let cancelled = false
    const id = window.setTimeout(() => {
      if (cancelled) return
      const h = computeHistogram(source)
      setHist(h)
      try {
        sessionStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            r: Array.from(h.r),
            g: Array.from(h.g),
            b: Array.from(h.b),
            max: h.max,
          }),
        )
      } catch {
        /* sessionStorage may be full; not fatal. */
      }
    }, 33)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [source])

  // When NO source is provided, run the synthetic pulse loop.
  const hasSource = source !== null
  const hadStoredRef = useRef(false)
  useEffect(() => {
    if (hasSource) return
    // Only synthesize if we don't already have stored data.
    if (typeof sessionStorage !== 'undefined') {
      hadStoredRef.current = sessionStorage.getItem(SESSION_KEY) !== null
    }
    if (hadStoredRef.current) return
    let raf = 0
    let t0 = 0
    const tick = (ts: number) => {
      if (!t0) t0 = ts
      const t = (ts - t0) / 1000
      setHist(syntheticHistogram(t))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [hasSource])

  return hist
}

interface RGBHistogramProps {
  /** Source bitmap/canvas to read pixels from. Null → synthetic pulse. */
  source?: ImageBitmap | HTMLCanvasElement | HTMLImageElement | null
  /** Optional pre-computed histogram. If provided, source is ignored. */
  histogram?: Histogram
  /** Render width in CSS pixels — viewBox is fixed at 256×96. */
  width?: number | string
  /** Render height. */
  height?: number | string
  /** ARIA label for the SVG. */
  label?: string
  /** Style override class. */
  className?: string
}

/**
 * Build an SVG path string for a single channel using a smooth fill from
 * baseline up to the bucket value. The path is closed at both ends.
 */
function pathFor(buckets: Uint32Array, max: number): string {
  const parts: string[] = ['M 0 96']
  for (let k = 0; k < 256; k++) {
    const x = k
    const y = 96 - (buckets[k] / max) * 96
    parts.push(`L ${x} ${y.toFixed(2)}`)
  }
  parts.push('L 256 96 Z')
  return parts.join(' ')
}

export default function RGBHistogram({
  source = null,
  histogram,
  width = '100%',
  height = 96,
  label = 'Live RGB histogram',
  className,
}: RGBHistogramProps) {
  const internal = useImageHistogram(histogram ? null : source ?? null)
  const h = histogram ?? internal

  const dR = pathFor(h.r, h.max)
  const dG = pathFor(h.g, h.max)
  const dB = pathFor(h.b, h.max)

  return (
    <svg
      className={className}
      role="img"
      aria-label={label}
      viewBox="0 0 256 96"
      preserveAspectRatio="none"
      style={{ width, height, display: 'block' }}
    >
      <path d={dR} fill="var(--rgb-r)" fillOpacity="0.5" />
      <path d={dG} fill="var(--rgb-g)" fillOpacity="0.5" />
      <path d={dB} fill="var(--rgb-b)" fillOpacity="0.5" />
    </svg>
  )
}
