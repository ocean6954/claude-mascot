// A mascot is one text file: a few `key: value` lines, then sections of drawing. See README.md.
//
//   color: #ffffff        the body's own color; left out, the body takes the spinner's color of the turn
//   overlay: #eb99b1      the color of the [overlay] cells
//   frame-ms: 120         how long each frame shows
//
//   [still]               how it stands while nothing runs (required)
//   [frame]               one frame of the animation, in order; `[frame x6]` holds it for six
//   [overlay]             cells drawn over every frame in the overlay color (cheeks, a scarf)

export type Mascot = {
  name: string
  still: readonly string[]
  frames: readonly (readonly string[])[]
  columns: number
  frameMs: number
  color?: string
  overlay?: { lines: readonly string[]; color: string }
}

export const DEFAULT_FRAME_MS = 120
const SECTION = /^\[(still|frame|overlay)(?:\s+x(\d+))?\]\s*$/
const SETTING = /^([a-z-]+):\s*(.*?)\s*$/

/** Reads a mascot file's text; throws with the file's name on a file that cannot be read as one. */
export function parseMascot(name: string, text: string): Mascot {
  const settings: Record<string, string> = {}
  const sections: { kind: 'still' | 'frame' | 'overlay'; count: number; lines: string[] }[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const section = SECTION.exec(line)
    if (section) {
      sections.push({ kind: section[1] as 'still' | 'frame' | 'overlay', count: Number(section[2] ?? 1), lines: [] })
      continue
    }
    const current = sections[sections.length - 1]
    if (current) {
      current.lines.push(line)
      continue
    }
    if (line.trim() === '' || line.startsWith('#')) continue
    const setting = SETTING.exec(line)
    if (!setting) throw new Error(`${name}: not a setting or a section: ${line}`)
    settings[setting[1]] = setting[2]
  }
  for (const section of sections) {
    while (section.lines.length > 0 && section.lines[section.lines.length - 1].trim() === '') section.lines.pop()
  }
  const still = sections.find(section => section.kind === 'still')
  if (!still || still.lines.length === 0) throw new Error(`${name}: needs a [still] drawing`)
  const rows = still.lines.length
  const columns = Math.max(...sections.flatMap(section => section.lines.map(width)))
  const fit = (lines: string[], kind: string): string[] => {
    if (lines.length !== rows) throw new Error(`${name}: a ${kind} has ${lines.length} rows, the still ${rows}`)
    return lines.map(line => line + ' '.repeat(columns - width(line)))
  }
  const stillLines = fit(still.lines, 'still')
  const frames = sections
    .filter(section => section.kind === 'frame')
    .flatMap(section => Array.from({ length: Math.max(1, section.count) }, () => fit(section.lines, 'frame')))
  const overlay = sections.find(section => section.kind === 'overlay')
  const frameMs = settings['frame-ms'] ? Number(settings['frame-ms']) : DEFAULT_FRAME_MS
  if (!Number.isFinite(frameMs) || frameMs <= 0) throw new Error(`${name}: frame-ms must be a positive number`)
  return {
    name,
    still: stillLines,
    frames: frames.length > 0 ? frames : [stillLines],
    columns,
    frameMs,
    color: settings.color || undefined,
    overlay: overlay ? { lines: fit(overlay.lines, 'overlay'), color: settings.overlay || '#eb99b1' } : undefined,
  }
}

/** Width in cells: one per code point, since every block, octant and braille character takes one. */
function width(line: string): number {
  return Array.from(line).length
}

export type MascotSegment = { text: string; color?: string }

/** One row of a mascot at a frame, cut into runs: the body in `bodyColor`, the overlay's cells in theirs. */
export function mascotSegments(mascot: Mascot, line: string, row: number, bodyColor: string): MascotSegment[] {
  const overlayCells = mascot.overlay ? Array.from(mascot.overlay.lines[row] ?? '') : []
  const segments: MascotSegment[] = []
  Array.from(line).forEach((cell, column) => {
    const overlayCell = overlayCells[column]
    const overlaid = overlayCell !== undefined && overlayCell !== ' '
    const color = overlaid ? mascot.overlay?.color ?? bodyColor : mascot.color ?? bodyColor
    const text = overlaid ? overlayCell : cell
    const last = segments[segments.length - 1]
    if (last && last.color === color) last.text += text
    else segments.push({ text, color })
  })
  return segments
}
