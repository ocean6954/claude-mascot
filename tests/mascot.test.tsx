import { expect, mock, test } from 'claude-code/testing'

import { mascotSegments, parseMascot } from '../hooks/mascots'

const SPINNER = {
  plugin: 'mascot',
  surface: 'terminal',
  component: 'Spinner',
  requestId: 'main',
  props: { word: 'Thinking', message: null, suffix: '…', mode: 'thinking' },
} as const

const FRONT_CAT_FILE = `# a cat
color: #ffffff
overlay: #eb99b1

[still]
 ▄▄
▐  ▌

[frame x2]
 ▄▄
▌  ▐

[overlay]

 ▖▗
`

test('a mascot file parses: settings, the still, held frames and the overlay', () => {
  const cat = parseMascot('front-cat', FRONT_CAT_FILE)
  expect(cat.columns).toBe(4)
  expect(cat.still).toEqual([' ▄▄ ', '▐  ▌'])
  expect(cat.frames).toEqual([
    [' ▄▄ ', '▌  ▐'],
    [' ▄▄ ', '▌  ▐'],
  ])
  expect(cat.color).toBe('#ffffff')
  expect(cat.overlay).toEqual({ lines: ['    ', ' ▖▗ '], color: '#eb99b1' })
  expect(cat.frameMs).toBe(120)
})

test('a mascot file without frames stands still; one without a still is refused', () => {
  const still = parseMascot('rock', '[still]\n█\n')
  expect(still.frames).toEqual([['█']])
  expect(still.color).toBeUndefined()
  expect(() => parseMascot('empty', 'color: red\n')).toThrow(/needs a \[still\]/)
  expect(() => parseMascot('ragged', '[still]\n█\n[frame]\n█\n█\n')).toThrow(/rows/)
  // An overlay whose last rows are blank is padded; one taller than the still is refused.
  expect(parseMascot('short', '[still]\n█\n█\n█\n[overlay]\n▀\n\n\n').overlay?.lines).toEqual(['▀', ' ', ' '])
  expect(() => parseMascot('tall', '[still]\n█\n[overlay]\n▀\n▀\n')).toThrow(/rows/)
})

test('a row splits into runs: the body in its color, the overlay in its own', () => {
  const cat = parseMascot('front-cat', FRONT_CAT_FILE)
  expect(mascotSegments(cat, '▐  ▌', 1, 'blue')).toEqual([
    { text: '▐', color: '#ffffff' },
    { text: '▖▗', color: '#eb99b1' },
    { text: '▌', color: '#ffffff' },
  ])
  const plain = parseMascot('rock', '[still]\n█▀\n')
  expect(mascotSegments(plain, '█▀', 0, 'blue')).toEqual([{ text: '█▀', color: 'blue' }])
})

test('the mascot files load from the plugin and the home directory, and dance beside the spinner', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/someone' })
  const files: Record<string, string> = {
    '/home/someone/.claude/mascots/dot.mascot': 'color: #123456\n\n[still]\n●\n\n[frame]\n○\n',
  }
  on('fs.exists', async (_, event) => ({ value: event.path.endsWith('/mascots') }))
  on('fs.list', async (_, event) => ({
    value: event.path.startsWith('/home/')
      ? [{ name: 'dot.mascot', kind: 'file', size: 1, mtimeMs: 0, isLink: false }]
      : [
          { name: 'README.txt', kind: 'file', size: 1, mtimeMs: 0, isLink: false },
          { name: 'broken.mascot', kind: 'file', size: 1, mtimeMs: 0, isLink: false },
        ],
  }))
  on('fs.read', async (_, event) => ({ value: files[event.path] ?? 'nonsense\n' }))
  const logs: string[] = []
  on('ui.log', async (_, event) => {
    logs.push(event.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['Thinking…'] }))
  on('turn.start', async (_, event) => ({ turnId: event.turnId }))
  on('turn.complete', async () => ({ text: '' }))

  await $.turn.start({ text: 'q', turnId: 't1' })
  const ui = await $.ui.mount(SPINNER)
  // The only mascot that parsed is the dot, so it is the one picked: ● standing, ○ at its one frame.
  expect(await ui.find({ text: /[●○]/ })).toBeDefined()
  expect(await ui.find({ text: /Thinking…/ })).toBeDefined()
  const texts = coloredTexts(await ui.drawn())
  expect(texts.find(text => /[●○]/.test(text.text))?.color).toBe('#123456')
  await ui.unmount()
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(logs.find(line => line.includes('broken.mascot'))).toBeDefined()
})

/** Every Text with a color of its own, with the text it holds: the innermost runs of a drawing. */
function coloredTexts(element: unknown): { color: string; text: string }[] {
  if (typeof element !== 'object' || element === null) return []
  const { type, props, children } = element as { type?: string; props?: { color?: string }; children?: unknown[] }
  const inner = (children ?? []).flatMap(coloredTexts)
  if (type === 'Text' && props?.color && inner.length === 0) {
    return [{ color: props.color, text: (children ?? []).filter(child => typeof child === 'string').join('') }]
  }
  return inner
}
