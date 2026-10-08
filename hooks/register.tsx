import type { EngineInterface, Register } from 'claude-code'

import { type Mascot, mascotSegments, parseMascot } from './mascots'

// Where the mascots live: the ones the plugin ships, and the ones a person adds.
const BUNDLED_DIR = 'mascots' // not shipped; a place for a fork to put its own
const USER_DIR = '.claude/mascots'
const MASCOT_FILE = /\.mascot$/
// Cells between the transcript's left edge and the mascot while the turn runs.
const MARGIN_LEFT = 2
const MARGIN_TOP = 1

// A mascot without a color of its own takes a new one each turn: one stop around the hue wheel,
// picked to sit on a dark grey background.
const TURN_COLORS = [
  'clawd_body', // the engine's own orange
  '#eb99b1', // rose
  '#ffd27f', // apricot
  '#d6dc86', // lime
  '#8fcd92', // green
  '#6bcacb', // teal
  '#8aa7d9', // slate blue
  '#b78bc9', // plum
]

// The animation: module variables, since losing them on a reload only restarts the dance.
let mascots: Mascot[] = []
let current: Mascot | undefined
let frame = 0
let timer: { cancel: () => void } | undefined
let turnColor = TURN_COLORS[0] ?? 'clawd_body'
// The turns under way: a subagent's turn ending leaves the main one dancing.
const runningTurns = new Set<string>()

/** Reads every mascot file in the bundled and the user directories; a bad file is skipped with a log line. */
async function loadMascots($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  const directories = [`${$.plugin.root}/${BUNDLED_DIR}`, ...(home ? [`${home}/${USER_DIR}`] : [])]
  const loaded: Mascot[] = []
  for (const directory of directories) {
    let entries: { name: string; kind: string }[] = []
    try {
      if (await $.fs.exists(directory)) entries = await $.fs.list(directory)
    } catch {
      continue
    }
    for (const entry of entries.filter(entry => entry.kind === 'file' && MASCOT_FILE.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      try {
        const text = await $.fs.read(`${directory}/${entry.name}`)
        loaded.push(parseMascot(entry.name.replace(MASCOT_FILE, ''), text as string))
      } catch (error) {
        $.ui.log(`mascot: skipped ${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  if (loaded.length > 0) mascots = loaded
}

function pickMascot(): Mascot | undefined {
  const others = mascots.filter(mascot => mascot !== current)
  return others[Math.floor(Math.random() * others.length)] ?? current
}

function pickTurnColor(): void {
  const others = TURN_COLORS.filter(color => color !== turnColor)
  turnColor = others[Math.floor(Math.random() * others.length)] ?? turnColor
}

function startAnimation($: EngineInterface): void {
  if (timer) return
  const mascot = current
  if (!mascot) return
  frame = 0
  timer = $.clock.every(mascot.frameMs, () => {
    frame = (frame + 1) % mascot.frames.length
    $.ui.invalidate('ui.render')
  })
  $.ui.invalidate('ui.render')
}

// Stopping leaves the frame as it is: the spinner is about to go, and redrawing it in another pose
// would flash the mascot's still for an instant first.
function stopAnimation(): void {
  timer?.cancel()
  timer = undefined
}

/** The mascot's lines: the frame reached, which is the still when nothing has ever run. */
function mascotLines(mascot: Mascot): readonly string[] {
  return mascot.frames[frame] ?? mascot.still
}

export const register: Register = on => {
  // The next turn's mascot is chosen while no turn runs: the spinner is drawn before turn.start
  // reaches this plugin, so whatever `current` holds at that moment is what shows first.
  on('session.start', async ($, event, next) => {
    await loadMascots($)
    current ??= pickMascot()
    return next(event)
  })

  on('turn.start', async ($, event, next) => {
    if (runningTurns.size === 0 && !current) {
      // Nothing chosen yet (a session.start that never ran): read now, once.
      if (mascots.length === 0) await loadMascots($)
      current = pickMascot()
    }
    runningTurns.add(event.turnId)
    startAnimation($)
    return next(event)
  })

  on('turn.complete', async ($, event, next) => {
    runningTurns.delete(event.turnId)
    if (runningTurns.size === 0) {
      stopAnimation()
      // Reread the directories between turns, so a file added or edited shows up without a restart,
      // then choose who comes out next time.
      await loadMascots($)
      current = pickMascot()
      pickTurnColor()
    }
    return next(event)
  })

  // The mascot dances beside the turn's spinner, which the engine still draws.
  on('ui.render', { component: 'Spinner' }, async ($, event, next) => {
    const { Box, Text } = $.ui.resolve(event)
    const theirs = await next(event)
    const mascot = current
    if (!mascot) return theirs
    return (
      <Box flexDirection="row" gap={2} marginTop={MARGIN_TOP} marginLeft={MARGIN_LEFT}>
        <Box flexDirection="column" flexShrink={0} width={mascot.columns}>
          {mascotLines(mascot).map((line, row) => (
            <Text wrap="truncate">
              {mascotSegments(mascot, line, row, turnColor).map(segment => (
                <Text color={segment.color}>{segment.text}</Text>
              ))}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" justifyContent="center" flexGrow={1} flexShrink={1}>
          {theirs}
        </Box>
      </Box>
    )
  })
}
