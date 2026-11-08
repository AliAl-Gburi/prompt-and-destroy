import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Forge, GameMessage, GameProps, GameResult, Progress } from '../types'
import { fallbackItem, FORGE_MAX_TOKENS, FORGE_MODEL, FORGE_SYSTEM, forgeRequest, MAX_PROMPT, matterWords, parseItem } from './forge'
import { backdrop, EMBLEM_BOX, forgeEmblem, pictureSize } from './vector'

const PANE = 'prompt-and-destroy'
const TITLE = 'Prompt & Destroy'
/** Rows the desktop's Forge panel may take above the game. */
const CONTROL_ROWS = 4
/**
 * The Forge panel's colors: the game's night sky, its orange, a dim blue for
 * what is said in passing, and for the slot the field sits in, the app's own
 * surface (a theme key, so light or dark it is what the field and its button
 * are drawn to stand on: on the night sky they all but vanish).
 */
const PANEL = { sky: '#0b1026', edge: '#ff8a3d', title: '#ff8a3d', dim: '#7f8bb3', slot: 'clawd_background' }
/** The emblem's width in pixels; its height follows its box. */
const EMBLEM_W = 50
/** The color of each word a thing's matter is described by. */
const MATTER_INK: Record<string, string> = {
  hot: '#ff8a3d',
  freezing: '#9ff6ff',
  explosive: '#ff5e5e',
  flammable: '#ffb347',
  melts: '#ffd8a8',
  wet: '#5fb8ff',
  live: '#fff36b',
  conductive: '#c9d3e0',
  corrosive: '#8cff3a',
}

// Change a tag when its value's fields change: an older stored value then
// reads as the initial one instead of a shape the code no longer knows.
const forgeAtom = atom({ plugin: 'prompt-and-destroy', key: 'forge' } as const, { status: 'idle' } as Forge, {
  shape: 'forge-2',
})
const progressAtom = atom(
  { plugin: 'prompt-and-destroy', key: 'progress' } as const,
  { level: 1, best: 0 } as Progress,
  { shape: 'progress-1' },
)

// The forging in flight, so a newer prompt cancels it. A reload forgets it,
// and the newer prompt's id then wins anyway.
let inflight: AbortController | undefined
let counter = 0

// What the desktop shows, as the game's Client posted it: the latest still
// frame, and over it the flights, newest on top. They change many times a
// second, so they live here and redraw by invalidating, not in $.state.
//
// A picture shows nothing while its source loads, and a flight takes long
// enough to load to see. So a flight goes over the still frame before it, and
// a later flight over the earlier, each covering what is under it once it has
// loaded; a landed flight stays over the still frame that follows it a moment
// longer, for that frame to load beneath it.
type Shown = { seq: number; svg: string; alt: string }
let still: Shown | undefined
let flights: Shown[] = []
let landing: { cancel: () => void } | undefined
const LANDING_MS = 400
// Results already counted: each rides on several frames.
const counted = new Set<string>()
// New on every load of this module: a changed prop makes a running Client post a fresh frame.
const EPOCH = Date.now()
// The desktop Client's props as last drawn. Which frame shows (`ack`) goes
// back with each post instead of in the drawing, so the drawing hands the
// Client the same props frame after frame: the desktop holds back a drawing
// that changes a Client's props while the pointer works over it.
let clientProps: GameProps | undefined
// The scenery, drawn once a size under every frame: the same source each
// redraw, so the surface never draws it again.
let scenery = { key: '', svg: '' }

function isProgress(v: unknown): v is Progress {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>

  return Number.isInteger(o.level) && (o.level as number) >= 1 && typeof o.best === 'number' && Number.isFinite(o.best)
}

function isResult(v: unknown): v is Omit<GameResult, 'id'> {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>

  return (
    Number.isInteger(o.level) &&
    (o.level as number) >= 1 &&
    typeof o.score === 'number' &&
    Number.isFinite(o.score) &&
    typeof o.won === 'boolean'
  )
}

function isGameMessage(v: unknown): v is GameMessage {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (o.type === 'result') return isResult(o)

  return (
    o.type === 'frame' &&
    Number.isInteger(o.seq) &&
    typeof o.anim === 'boolean' &&
    typeof o.svg === 'string' &&
    o.svg.startsWith('<svg') &&
    typeof o.alt === 'string' &&
    Array.isArray(o.results) &&
    o.results.every(r => isResult(r) && typeof (r as Record<string, unknown>).id === 'string')
  )
}

/** Opens the game's pane; answers why not when the surface could not show it. */
async function openPane($: EngineInterface): Promise<string | null> {
  const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, columns: 120, rows: 36 })

  return opened.isPlaced ? null : opened.reason
}

/** Asks the model to make an object of the prompt; puts it in the Forge. */
async function forge($: EngineInterface, typed: string): Promise<void> {
  const prompt = typed.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT)
  if (!prompt) return
  inflight?.abort()
  const stop = new AbortController()
  inflight = stop
  const id = `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
  await update($, forgeAtom, (): Forge => ({ status: 'forging', id, prompt }))

  let item = undefined as ReturnType<typeof parseItem>
  let note: string | null = null
  try {
    const reply = await $.model.complete(
      {
        model: FORGE_MODEL,
        system: [{ text: FORGE_SYSTEM, cache: true }],
        prompt: forgeRequest(prompt),
        maxTokens: FORGE_MAX_TOKENS,
        effort: 'low',
        timeoutMs: 60_000,
      },
      { signal: stop.signal },
    )
    if (stop.signal.aborted) return
    if (reply.isAnswered) {
      item = parseItem(reply.text, prompt, id)
      if (!item) note = 'The Forge mumbled, so it improvised.'
    } else {
      note = `The Forge is offline (${reply.reason}), so it improvised.`
    }
  } catch (err) {
    note = `The Forge is offline (${err instanceof Error ? err.message : 'no model'}), so it improvised.`
  }
  if (stop.signal.aborted) return
  const ready = item ?? fallbackItem(prompt, id)
  await update($, forgeAtom, (f): Forge => (f.status === 'forging' && f.id === id ? { status: 'ready', item: ready, note } : f))
}

function forgeLine(f: Forge): { text: string; color: string } {
  if (f.status === 'forging') return { text: `⚒ Forging "${f.prompt}"...`, color: '#ff8a3d' }
  if (f.status === 'ready') {
    const i = f.item
    const tags = [`${i.width.toFixed(1)}×${i.height.toFixed(1)} m`, i.shape === 'polygon' ? 'shaped' : i.shape, `density ${i.density}`]
    if (i.bounce >= 0.5) tags.push('bouncy')
    tags.push(...i.traits, ...matterWords(i.matter))
    if (i.ability !== 'none') tags.push(i.power?.name || i.ability)

    return { text: `⚒ Last forged: ${i.name} (${tags.join(', ')})${f.note ? `. ${f.note}` : ''}`, color: '#9aa5c4' }
  }

  return { text: '⚒ The Forge is idle. Name an object and press Enter.', color: '#9aa5c4' }
}

/** The Forge's state on the desktop, a word or two at a time, each in its own color. */
function forgeParts(f: Forge): { text: string; color: string; weight?: 'semibold' }[] {
  if (f.status === 'forging') return [{ text: `Forging "${f.prompt}"...`, color: PANEL.title, weight: 'semibold' }]
  if (f.status !== 'ready') return [{ text: 'Name anything and press Enter: it drops into the sling.', color: PANEL.dim }]
  const i = f.item
  const parts: { text: string; color: string; weight?: 'semibold' }[] = [
    { text: 'Last forged', color: PANEL.dim },
    { text: i.name, color: '#ffffff', weight: 'semibold' },
    { text: `${i.width.toFixed(1)}×${i.height.toFixed(1)} m`, color: PANEL.dim },
  ]
  if (i.ability !== 'none') parts.push({ text: `✦ ${i.power?.name || i.ability}`, color: '#ffd166' })
  for (const w of matterWords(i.matter)) parts.push({ text: w, color: MATTER_INK[w] ?? '#c9d3e0' })
  for (const t of i.bounce >= 0.5 ? [...i.traits, 'bouncy'] : i.traits) parts.push({ text: t, color: '#c6a8ff' })
  if (f.note) parts.push({ text: f.note, color: PANEL.dim })

  return parts
}

/** Counts a finished level once: the saved level moves on, the best score stays. */
async function record($: EngineInterface, result: Omit<GameResult, 'id'>): Promise<void> {
  const progress = await update($, progressAtom, p => ({
    level: result.won ? Math.max(p.level, result.level + 1) : p.level,
    best: Math.max(p.best, result.score),
  }))
  await $.store.set('progress', progress)
  if (result.won) $.ui.toast(`Prompt & Destroy: level ${result.level} cleared, ${result.score} points`)
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prompt-and-destroy',
      description: 'Play Prompt & Destroy: fling objects you prompt into existence at towers of bugs',
      argumentHint: '[reset]',
    })
    const saved = await $.store.get('progress')
    if (isProgress(saved)) await update($, progressAtom, () => saved)

    return next(e)
  })

  on('command.run', { command: 'prompt-and-destroy' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      await update($, progressAtom, () => ({ level: 1, best: 0 }))
      await $.store.delete('progress')
      await $.ui.close({ id: PANE })

      return { text: 'Prompt & Destroy progress reset. Run /prompt-and-destroy to start again at level 1.' }
    }
    const unplaced = await openPane($)
    if (unplaced) return { text: `Prompt & Destroy is open but not shown yet: ${unplaced}` }

    return { text: 'Prompt & Destroy is open. Type an object in the Forge field and press Enter.' }
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== 'game' || !isGameMessage(e.data)) return next(e)
    const msg = e.data
    if (msg.type === 'result') {
      await record($, msg)

      return {}
    }
    const shown = { seq: msg.seq, svg: msg.svg, alt: msg.alt }
    if (msg.anim) {
      landing?.cancel()
      landing = undefined
      flights = [...flights.slice(-1), shown]
    } else {
      still = shown
      if (flights.length > 0 && !landing) {
        landing = $.clock.after(LANDING_MS, () => {
          flights = []
          landing = undefined
          $.ui.invalidate('ui.render')
        })
      }
    }
    $.ui.invalidate('ui.render')
    for (const r of msg.results) {
      if (counted.has(r.id)) continue
      counted.add(r.id)
      if (counted.size > 200) counted.delete(counted.values().next().value as string)
      await record($, r)
    }

    return clientProps ? { props: { ...clientProps, ack: msg.seq } } : {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const forgeState = await read($, forgeAtom)
    const progress = await read($, progressAtom)
    const line = forgeLine(forgeState)
    const placeholder = 'name anything to fling: a grand piano, a jar of bees, my inbox...'

    if (e.surface === 'desktop') {
      const { Box, Text, Input, Svg, Client } = $.ui.resolve(e)
      const cols = Math.max(20, e.props.bodyColumns)
      // The surface lays the picture out in pixels and the Client in cells, so
      // a Client sized "100%" of the picture gets one row. Sized in cells, it
      // fills the pane under the Forge field instead (the field and its line
      // above take at most CONTROL_ROWS).
      const playRows = Math.max(8, e.props.scroll.bodyRows - CONTROL_ROWS)
      // Every layer the same size in pixels, given outright, so they line up,
      // and the size of those cells, so the Client's cells lie over the
      // picture where it expects them. Its shape is the pane's: a tall pane
      // shows more sky over the level, a wide one more land either side.
      const { W, H, view } = pictureSize(cols, playRows)
      const key = `${W}x${H}`
      if (scenery.key !== key) scenery = { key, svg: backdrop(view) }

      // The layers: the scenery, drawn once; the still frame of what moves;
      // the flights over it, each one SMIL animation, scenery and all; and the
      // game's Client, invisible on top, taking the drags, clicks and keys and
      // posting the frames. `drawn` tells the Client when its flight is on
      // screen, so its clock starts there.
      //
      // The desktop builds the pane afresh on every redraw and keeps only
      // what it draws in a frame of its own, an interactive Svg left as it
      // was. A plain picture is a new one each time, and a flight in one
      // would start over, from the launch, whenever anything else changed:
      // a still frame landing under it, or a second flight going over it.
      // The scenery is in a frame too, kept from the pane's first drawing to
      // its last: with one always up, each flight's frame opens in a tenth
      // of the time the first one takes.
      return (
        <Box flexDirection="column" width={cols}>
          {/* The Forge: an anvil at work while it forges, the field in its slot, what it made last below. */}
          <Box
            key="forge"
            flexDirection="row"
            alignItems="center"
            columnGap="md"
            width={cols}
            backgroundColor={PANEL.sky}
            borderStyle="round"
            borderColor={PANEL.edge}
            paddingX="md"
            paddingY="xs"
          >
            <Svg
              source={forgeEmblem(forgeState.status === 'forging')}
              alt={forgeState.status === 'forging' ? 'The Forge at work: a hammer striking a glowing ingot.' : 'The Forge: an anvil with a glowing ingot.'}
              width={EMBLEM_W}
              height={Math.round((EMBLEM_W * EMBLEM_BOX.h) / EMBLEM_BOX.w)}
              isInteractive
            />
            <Box flexDirection="column" flexGrow={1} rowGap="xs">
              <Box flexDirection="row" alignItems="center" columnGap="md">
                <Text color={PANEL.title} weight="bold" mono>
                  THE FORGE
                </Text>
                {/* A one-line field keeps its own width, whatever its box: the slot fits round it. */}
                <Box key="slot" flexDirection="row" alignItems="center" backgroundColor={PANEL.slot} borderStyle="round" borderColor={PANEL.edge} padding="xs">
                  <Input key="prompt" placeholder={placeholder} submitLabel="⚒ forge" autoFocus onSubmit={value => void forge($, value)} />
                </Box>
              </Box>
              <Text wrap="truncate-end">
                {forgeParts(forgeState).flatMap((p, k) => [
                  ...(k > 0 ? [<Text color={PANEL.dim}>{'  ·  '}</Text>] : []),
                  <Text color={p.color} weight={p.weight}>
                    {p.text}
                  </Text>,
                ])}
              </Text>
            </Box>
          </Box>
          <Box key="stage" position="relative" width={cols} flexDirection="column">
            <Svg source={scenery.svg} alt="A night sky over grassy hills, a slingshot on the left." width={W} height={H} isInteractive />
            {still ? (
              <Box key="still" position="absolute" top={0} left={0} width={cols}>
                <Svg source={still.svg} alt={still.alt} width={W} height={H} />
              </Box>
            ) : null}
            {flights.map(f => (
              <Box key={`flight-${f.seq}`} position="absolute" top={0} left={0} width={cols}>
                <Svg source={f.svg} alt={f.alt} width={W} height={H} isInteractive />
              </Box>
            ))}
            <Box position="absolute" top={0} left={0} width={cols} height={playRows}>
              <Client
                key="game"
                module="./game.tsx"
                props={(clientProps = {
                  forge: forgeState,
                  level: progress.level,
                  best: progress.best,
                  vector: true,
                  cols,
                  rows: playRows,
                  epoch: EPOCH,
                  ack: 0,
                  drawn: flights.at(-1)?.seq ?? 0,
                })}
                width={cols}
                height={playRows}
              />
            </Box>
          </Box>
        </Box>
      )
    }
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)

      return <Text>Prompt & Destroy needs the terminal or the desktop app.</Text>
    }
    const { Box, Text, Input, Client } = $.ui.resolve(e)
    const cols = Math.max(20, e.props.bodyColumns)
    const rows = Math.max(12, e.props.scroll.bodyRows)

    return (
      <Box flexDirection="column" width={cols}>
        <Client
          key="game"
          module="./game.tsx"
          props={{ forge: forgeState, level: progress.level, best: progress.best, vector: false, cols, rows: rows - 3, epoch: EPOCH, ack: 0 }}
          width={cols}
          height={rows - 3}
        />
        <Input
          key="prompt"
          label="Forge ▸ "
          placeholder={placeholder}
          submitLabel="forge"
          autoFocus
          onSubmit={value => {
            void forge($, value)
          }}
        />
        <Text color={line.color} wrap="truncate-end">
          {line.text}
        </Text>
      </Box>
    )
  })
}
