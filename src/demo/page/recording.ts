/**
 * **A recording on the page** (M33 F11, M56 U6): a file served beside the page,
 * put at the head of its figure and the figure shown. Muted, looped, with its
 * controls; round and round while it is on screen, as the reel goes. Under
 * reduced motion it is still: nothing plays until the controls start it, and a
 * clip with a poster frame shows that frame rather than loading the video.
 */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

export function mountRecording(figure: HTMLElement, file: string, poster?: string): HTMLVideoElement {
  const video = document.createElement('video')
  video.src = file
  if (poster !== undefined) video.poster = poster
  video.controls = true
  video.muted = true
  video.preload = reduced.matches && poster !== undefined ? 'none' : 'metadata'
  video.playsInline = true
  video.loop = true
  figure.prepend(video)
  figure.hidden = false
  if (!reduced.matches) {
    new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void video.play().catch(() => undefined)
        else video.pause()
      },
      { threshold: 0.35 },
    ).observe(video)
  }
  return video
}
