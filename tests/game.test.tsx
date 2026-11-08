import { expect, mock, test } from 'claude-code/testing'

import { forgeEmblem } from '../hooks/vector'

const PANE = {
  plugin: 'prompt-and-destroy',
  component: 'Pane',
  requestId: 'prompt-and-destroy',
  props: {
    title: 'Prompt & Destroy',
    isFocused: true,
    bodyColumns: 100,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 32 },
    view: {},
  },
} as const

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const PIANO =
  JSON.stringify({
    name: 'Grand Piano',
    width: 2,
    height: 1.2,
    density: 1.5,
    friction: 0.6,
    bounce: 0.1,
    color: '#222222',
    shape: 'polygon',
    points: [
      [0, 120],
      [0, 40],
      [60, 0],
      [150, 0],
      [200, 50],
      [200, 120],
    ],
    ability: 'none',
    traits: [],
    quip: 'Play it again, Sam!',
  }) +
  '\n<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg"><path d="M10 40Q10 10 60 10H150Q195 10 195 50V75H10Z" fill="#26262c" stroke="#0a0a0a" stroke-width="5"/><rect x="20" y="75" width="170" height="16" fill="#f4f4f4"/></svg>'

type Found = { props: Record<string, unknown> }

type Mounted = { findAll: (q: { type: string }) => Promise<Found[]> }

/** The game's pictures, bottom up: the scenery, the still frame, the flights (the Forge's emblem left out). */
async function stage(ui: Mounted): Promise<Found[]> {
  return (await ui.findAll({ type: 'Svg' })).filter(s => !String(s.props.alt).startsWith('The Forge'))
}

/** The frame the desktop pane draws now: the Svg over the backdrop, '' before the first. */
async function picture(ui: Mounted): Promise<string> {
  const svgs = await stage(ui)

  return svgs.length > 1 ? String(svgs[svgs.length - 1]!.props.source ?? '') : ''
}

test('a prompt is forged into the pouch and flung, in terminal cells', async ($, on) => {
  mock.store(on)
  const asked: string[] = []
  on('model.complete', (_, e) => {
    asked.push(e.prompt)

    return { value: { isAnswered: true, text: `Here you go: ${PIANO}`, usage: USAGE } }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 100, rows: 29, in: 'game' })
  await ui.advance(2000)
  expect((await ui.find({ in: 'game', type: 'Text', text: /Level 1: Squash the bugs/ }))?.type).toBe('Text')

  await ui.input({ key: 'prompt', text: 'a grand piano' })
  expect(asked.at(-1)).toContain('a grand piano')
  expect((await ui.find({ type: 'Text', text: /Last forged: Grand Piano/ }))?.type).toBe('Text')
  expect((await ui.find({ in: 'game', type: 'Text', text: /Grand Piano loaded/ }))?.type).toBe('Text')

  // Drag left and down from the middle, then let go: a full-power fling.
  await ui.pointer({ type: 'down', x: 50, y: 14, button: 'left' })
  await ui.pointer({ type: 'move', x: 34, y: 22, button: 'left' })
  expect((await ui.find({ in: 'game', type: 'Text', text: /power \d+%/ }))?.type).toBe('Text')
  await ui.pointer({ type: 'up', x: 34, y: 22, button: 'left' })
  expect((await ui.find({ in: 'game', type: 'Text', text: /●●○/ }))?.type).toBe('Text')

  await ui.advance(15000)
  expect(await ui.find({ in: 'game', type: 'Text', text: /Score \d+/ })).toBeDefined()
  await ui.unmount()
})

test('on the desktop the game is an SVG picture under an invisible Client', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: PIANO, usage: USAGE } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const backdrop = String((await stage(ui))[0]?.props.source)
  expect(backdrop).toContain('<svg')
  // In a frame of its own, kept by the desktop from redraw to redraw.
  expect((await stage(ui))[0]?.props.isInteractive).toBe(true)
  expect(backdrop.length).toBeLessThan(131_072)
  await ui.resize({ columns: 100, rows: 26, in: 'game' })
  await ui.advance(2000)
  const first = await picture(ui)
  expect(first.startsWith('<svg')).toBe(true)
  expect(first).toContain('Level 1: Squash the bugs')
  // The scenery is drawn once, under the frames, and never changes.
  expect(String((await stage(ui))[0]?.props.source)).toBe(backdrop)
  expect(first.length).toBeLessThan(backdrop.length + 15_000)
  // Which frame was taken goes back in the answer to each post, not in the
  // drawing: the Client's drawn props stay the same from frame to frame.
  const drawnProps = JSON.stringify((await ui.find({ type: 'Client', key: 'game' }))?.props.props)
  await ui.advance(400)
  expect(JSON.stringify((await ui.find({ type: 'Client', key: 'game' }))?.props.props)).toBe(drawnProps)
  expect(JSON.parse(drawnProps).ack).toBe(0)
  // The Client itself draws nothing visible over the picture: blank rows only.
  const drawn = await ui.findAll({ in: 'game', type: 'Text' })
  expect(drawn.length).toBe(28)
  expect(drawn.every(t => t.text.trim() === '')).toBe(true)
  // Sized in cells, not "100%" of a picture the layout measures in pixels:
  // the pane's 32 rows less the Forge field's.
  expect((await ui.find({ type: 'Client', key: 'game' }))?.props).toMatchObject({ width: 100, height: 28 })

  await ui.input({ key: 'prompt', text: 'a grand piano' })
  await ui.advance(200)
  const loaded = await picture(ui)
  expect(loaded).toContain('Grand Piano')
  // The Forge's art is drawn in the frame.
  expect(loaded).toContain('#f4f4f4')

  // Dragging, the Client's arc follows at once.
  await ui.pointer({ type: 'down', x: 50, y: 12, button: 'left' })
  await ui.pointer({ type: 'move', x: 34, y: 17, button: 'left' })
  await ui.advance(300)
  expect((await ui.findAll({ in: 'game', type: 'Text' })).some(t => /[\u2801-\u28ff]/.test(t.text))).toBe(true)
  // Let go, the sling holds where it was pulled, the drawing in its pouch.
  await ui.pointer({ type: 'up', x: 34, y: 17, button: 'left' })
  await ui.advance(200)
  const held = await picture(ui)
  expect(held).toMatch(/power \d+%  ·  click \(or space\) to fling/)
  expect(held).toContain('#f4f4f4')
  // Click, it flies: the whole flight as one SMIL animation, in a picture
  // like any frame, over the held frame, which stays as it was.
  await ui.pointer({ type: 'down', x: 34, y: 17, button: 'left' })
  await ui.pointer({ type: 'up', x: 34, y: 17, button: 'left' })
  await ui.advance(100)
  // In a frame of its own, which the desktop keeps from redraw to redraw,
  // so the flight never starts over when the pane changes around it.
  const flight = (await stage(ui)).at(-1)
  expect(flight?.props.isInteractive).toBe(true)
  const anim = String(flight?.props.source)
  expect(anim).toContain('<animateTransform')
  const layers = await stage(ui)
  expect(layers.length).toBe(3)
  expect(String(layers[1]!.props.source)).toBe(held)
  expect((await ui.find({ type: 'Box', key: 'still' }))?.type).toBe('Box')
  expect(anim.length).toBeLessThan(100_000)

  // When it has played out, the still frame of where everything came to rest
  // goes under it, the flight left just as it was until that has loaded.
  await ui.advance(5000)
  const landed = await stage(ui)
  expect(String(landed[1]!.props.source)).not.toBe(held)
  expect(landed[2]!.props).toMatchObject({ source: anim, isInteractive: true })

  // A moment later, only the still frame.
  await ui.advance(10000)
  await clock.advance(500)
  const after = (await stage(ui)).at(-1)
  expect(after?.props.isInteractive).toBeUndefined()
  expect(String(after?.props.source)).toMatch(/Score <tspan font-weight="700">\d+/)
  await ui.unmount()
})

test('a click holds the sling: moving aims with the arc showing, the next click flings', async ($, on) => {
  mock.store(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: PIANO, usage: USAGE } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ columns: 100, rows: 26, in: 'game' })
  await ui.advance(200)
  await ui.input({ key: 'prompt', text: 'a grand piano' })
  await ui.advance(200)

  // Every picture is drawn at one size, the animation's frame included.
  const sizes = (await stage(ui)).map(s => `${s.props.width}x${s.props.height}`)
  expect(sizes.length).toBe(2)
  expect(new Set(sizes).size).toBe(1)
  // The pane's width, and the 28 rows under the Forge field: its shape, taller than the world's.
  expect(sizes[0]).toBe('880x560')

  await ui.pointer({ type: 'down', x: 50, y: 12, button: 'left' })
  await ui.pointer({ type: 'up', x: 50, y: 12, button: 'left' })
  // Aiming frames go every AIM_FRAME_MS (120): wait one out.
  await ui.advance(200)
  expect(await picture(ui)).toContain('move away from where you clicked')
  // No button down: the pointer alone pulls the sling, and the arc follows
  // at once, drawn by the Client itself in braille dots, a ◎ where it hits.
  await ui.pointer({ type: 'move', x: 36, y: 16 })
  const arc = (await ui.findAll({ in: 'game', type: 'Text' })).filter(t => /[\u2801-\u28ff◎]/.test(t.text))
  expect(arc.length).toBeGreaterThan(10)
  expect(arc.some(t => t.text === '◎')).toBe(true)
  await ui.advance(200)
  // Shown (here at once): the picture's sling, the Forge's drawing in its
  // pouch, is the sling; the Client draws no bands of its own.
  expect((await ui.findAll({ in: 'game', type: 'Text' })).filter(t => t.props.color === '#e8b67a').length).toBe(0)
  const aiming = await picture(ui)
  expect(aiming).toContain('#f4f4f4')
  expect(aiming).toMatch(/power \d+%  ·  click \(or space\) to fling/)
  // The frames leave the arc to the Client, and glide the sling (its bands
  // and the drawing in its pouch) from where the last frame left it.
  expect(aiming).not.toContain('stroke="#ff8a3d" stroke-width="3"/>')
  expect(aiming).toContain('<animate attributeName="d" from="M')
  expect(aiming).toMatch(/<animateTransform attributeName="transform" type="translate" from="[-\d. ]+" to="0 0" dur="0.12s" fill="freeze"\/>/)

  await ui.pointer({ type: 'down', x: 36, y: 16, button: 'left' })
  // Flung: the arc goes with it.
  expect((await ui.findAll({ in: 'game', type: 'Text' })).filter(t => /[\u2801-\u28ff◎]/.test(t.text)).length).toBe(0)
  await ui.advance(100)
  const flight = (await stage(ui)).at(-1)
  expect(String(flight?.props.source)).toContain('<animateTransform')
  expect(flight?.props.width).toBe(880)
  await ui.unmount()
})

test('a click mid-flight fires the ability as its flight takes over', async ($, on) => {
  mock.store(on)
  const bomb = PIANO.replace('"ability":"none"', '"ability":"explode"').replace('Grand Piano', 'Piano Bomb')
  on('model.complete', () => ({ value: { isAnswered: true, text: bomb, usage: USAGE } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ columns: 100, rows: 26, in: 'game' })
  await ui.advance(200)
  await ui.input({ key: 'prompt', text: 'a piano bomb' })
  await ui.advance(200)
  await ui.pointer({ type: 'down', x: 50, y: 12, button: 'left' })
  await ui.pointer({ type: 'move', x: 34, y: 17, button: 'left' })
  await ui.pointer({ type: 'up', x: 34, y: 17, button: 'left' })
  await ui.advance(200)
  // Held: a click flings it.
  await ui.pointer({ type: 'down', x: 34, y: 17, button: 'left' })
  await ui.pointer({ type: 'up', x: 34, y: 17, button: 'left' })
  await ui.advance(200)
  const before = await picture(ui)
  // Named for the object: a bomb the Forge gave no name for its power goes "Kaboom".
  expect(before).toContain('Click or press space: KABOOM!')

  // Clicked, the ability waits for the button to go up, as the desktop draws
  // nothing new in the pane before: its flight then starts where the shot
  // will be shown.
  await ui.pointer({ type: 'down', x: 60, y: 10, button: 'left' })
  for (let i = 0; i < 5; i++) {
    await ui.pointer({ type: 'move', x: 60 + i, y: 10, button: 'left' })
    await ui.advance(20)
  }
  expect(await picture(ui)).toBe(before)
  await ui.pointer({ type: 'up', x: 64, y: 10, button: 'left' })
  await ui.advance(100)
  const resumed = await picture(ui)
  expect(resumed).not.toBe(before)
  expect(resumed).toContain('<animateTransform')
  expect(resumed).toContain('Kaboom!')
  // The first flight stays under it as it was, in its own frame, so the
  // desktop keeps it playing instead of starting it over from the launch.
  const flights = (await stage(ui)).slice(2)
  expect(flights.every(s => s.props.isInteractive === true)).toBe(true)
  expect(flights.map(s => String(s.props.source))).toEqual([before, resumed])
  await ui.unmount()
})

test('a power goes off in the first moment of the flight that shows it', async ($, on) => {
  mock.store(on)
  const gun =
    PIANO.replace(
      '"ability":"none"',
      '"ability":"shoot","power":{"name":"Open Fire","facing":"right","aim":"target","round":{"size":[0.3,0.1],"count":4,"every":0.08,"speed":30,"gravity":0.1,"punch":2,"turn":"point"}}',
    ).replace('Grand Piano', 'Piano Gun') +
    '\n<svg viewBox="0 0 30 10" xmlns="http://www.w3.org/2000/svg"><rect width="30" height="10" rx="5" fill="#ffd166"/></svg>'
  on('model.complete', () => ({ value: { isAnswered: true, text: gun, usage: USAGE } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ columns: 100, rows: 26, in: 'game' })
  await ui.advance(200)
  await ui.input({ key: 'prompt', text: 'a piano gun' })
  await ui.advance(200)
  await ui.pointer({ type: 'down', x: 50, y: 12, button: 'left' })
  await ui.pointer({ type: 'move', x: 34, y: 17, button: 'left' })
  await ui.pointer({ type: 'up', x: 34, y: 17, button: 'left' })
  await ui.advance(200)
  await ui.pointer({ type: 'down', x: 34, y: 17, button: 'left' })
  await ui.pointer({ type: 'up', x: 34, y: 17, button: 'left' })
  await ui.advance(300)
  const before = await picture(ui)
  expect(before).toContain('Click or press space: OPEN FIRE!')
  await ui.pointer({ type: 'down', x: 60, y: 10, button: 'left' })
  await ui.advance(40)
  await ui.pointer({ type: 'up', x: 60, y: 10, button: 'left' })
  await ui.advance(100)
  const resumed = await picture(ui)
  expect(resumed).not.toBe(before)
  // A flash where it hands over, the gun turning before the first round:
  // every bullet appears after the flight's first moment.
  expect(resumed).toContain('values="0.7;0"')
  // The Forge's own drawing of its round, defined once, used for each.
  expect(resumed).toContain('<g id="pd-round-0"')
  const rounds = resumed.split('<use href="#pd-round-0"/>').length - 1
  expect(rounds).toBe(4)
  const shown = [...resumed.matchAll(/<g transform="translate\([^)]*\)"( visibility="hidden")?><set attributeName="visibility" to="visible" begin="([\d.]+)s"/g)]
  expect(shown.length).toBeGreaterThan(0)
  await ui.unmount()
})

test('the Forge improvises when the model is out of reach', async ($, on) => {
  mock.store(on)
  on('model.complete', () => ({
    value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE },
  }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'prompt', text: 'a stick of dynamite' })
  const line = await ui.find({ type: 'Text', text: /Last forged:/ })
  expect(line?.text).toContain('A Stick Of Dynamite')
  expect(line?.text).toContain('Kaboom')
  expect(line?.text).toContain('improvised')
  await ui.unmount()
})

test('a cleared level moves the saved level on and keeps the best score', async ($, on) => {
  const saved = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: saved.get(e.key) }))
  on('store.set', (_, e) => {
    saved.set(e.key, e.value)

    return { value: undefined }
  })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String(e.text))

    return { value: undefined }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.post({ type: 'result', level: 1, score: 3500, won: true }, { in: 'game' })
  await ui.post({ type: 'result', level: 2, score: 1200, won: false }, { in: 'game' })
  // Junk from the Client is ignored.
  await ui.post({ type: 'result', level: -4, score: 'lots', won: 'yes' }, { in: 'game' })

  const client = await ui.find({ type: 'Client', key: 'game' })
  expect(client?.props.props).toMatchObject({ level: 2, best: 3500 })
  expect(saved.get('progress')).toEqual({ level: 2, best: 3500 })
  expect(toasts).toEqual(['Prompt & Destroy: level 1 cleared, 3500 points'])
  await ui.unmount()
})

test('a result riding on several desktop frames counts once', async ($, on) => {
  const saved = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: saved.get(e.key) }))
  on('store.set', (_, e) => {
    saved.set(e.key, e.value)

    return { value: undefined }
  })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String(e.text))

    return { value: undefined }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const win = { id: 'r1', level: 1, score: 2000, won: true }
  for (let i = 0; i < 3; i++) {
    await ui.post({ type: 'frame', seq: i + 1, anim: false, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', alt: 'frame', results: [win] }, { in: 'game' })
  }
  expect(toasts).toEqual(['Prompt & Destroy: level 1 cleared, 2000 points'])
  expect(saved.get('progress')).toEqual({ level: 2, best: 2000 })
  // A frame that is not an SVG document is ignored.
  await ui.post({ type: 'frame', seq: 4, anim: false, svg: '<script>alert(1)</script>', alt: 'x', results: [] }, { in: 'game' })
  expect(await picture(ui)).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  await ui.unmount()
})

test('the Forge is a panel of its own over the game: an anvil, the field across it, what it made in color', async ($, on) => {
  mock.store(on)
  const keg = PIANO.replace('"ability":"none"', '"ability":"explode","power":{"name":"Powder Blast"},"matter":{"burns":1,"explodes":0.9}').replace('Grand Piano', 'Powder Heap')
  on('model.complete', () => ({ value: { isAnswered: true, text: keg, usage: USAGE } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const panel = await ui.find({ type: 'Box', key: 'forge' })
  expect(panel?.props).toMatchObject({ backgroundColor: '#0b1026', borderStyle: 'round', borderColor: '#ff8a3d' })
  // The anvil, in a frame of its own so its embers rise without starting over at every redraw.
  const anvil = (await ui.findAll({ type: 'Svg' })).find(s => String(s.props.alt).startsWith('The Forge'))
  expect(anvil?.props.isInteractive).toBe(true)
  expect(String(anvil?.props.source)).toBe(forgeEmblem(false))
  // The field sits in a slot of the app's own surface, so it and its button show in either theme;
  // the title is drawn beside it, in the game's orange.
  expect((await ui.find({ type: 'Box', key: 'slot' }))?.props).toMatchObject({ backgroundColor: 'clawd_background', borderColor: '#ff8a3d' })
  expect((await ui.find({ type: 'Input', key: 'prompt' }))?.props.label).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'THE FORGE' }))?.props).toMatchObject({ color: '#ff8a3d', weight: 'bold' })

  await ui.input({ key: 'prompt', text: 'a powder heap' })
  // Each word in its own color, inside the one line.
  const word = async (text: string) => (await ui.findAll({ type: 'Text', text })).find(t => t.text === text)?.props.color
  expect(await word('Powder Heap')).toBe('#ffffff')
  expect(await word('✦ Powder Blast')).toBe('#ffd166')
  expect(await word('explosive')).toBe('#ff5e5e')
  await ui.unmount()
})

test('the anvil at rest glows; at work its hammer strikes and throws sparks', () => {
  const rest = forgeEmblem(false)
  const work = forgeEmblem(true)
  expect(rest).not.toContain('type="rotate" values')
  expect(work).toMatch(/type="rotate" values="38 62 18;0 62 18;38 62 18" keyTimes="0;0.3;1"/)
  // A spark leaves at each strike, a third of the way through the beat.
  expect(work.match(/values="0;1;0" keyTimes="0;0.3;1"/g)?.length).toBe(6)
  for (const svg of [rest, work]) {
    expect(svg.length).toBeLessThan(6000)
    for (const tag of svg.match(/<[a-zA-Z][^>]*>/g) ?? []) {
      const names = [...tag.matchAll(/\s([a-zA-Z:-]+)=/g)].map(m => m[1])
      expect(new Set(names).size).toBe(names.length)
    }
  }
})
