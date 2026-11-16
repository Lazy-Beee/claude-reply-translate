import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { fingerprint } from './register'

const WORKING = 'Let me read the config file first.'
const FINAL_EN = 'All done. The fix is in `src/app.ts`, and the tests pass.'
const FINAL_ZH = '已经改好了，修复在 `src/app.ts` 里，测试都通过了。'
const FINAL_JA = '修正が完了しました。変更は `src/app.ts` にあります。'

type Block = { type: string; [field: string]: unknown }
type Message = { role: 'user' | 'assistant'; content: Block[] }

const MESSAGES: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'Fix the bug' }] },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: WORKING },
      { type: 'tool_use', id: 't1', name: 'Read', input: {} },
    ],
  },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
  { role: 'assistant', content: [{ type: 'text', text: FINAL_EN }] },
  { role: 'user', content: [{ type: 'text', text: '用中文说' }] },
  { role: 'assistant', content: [{ type: 'text', text: FINAL_ZH }] },
  { role: 'user', content: [{ type: 'text', text: '日本語で' }] },
  { role: 'assistant', content: [{ type: 'text', text: FINAL_JA }] },
]

const USAGE = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const reply = (text: string) =>
  ({
    plugin: 'reply-translate',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
  }) as const

type On = Parameters<TestBody>[1]

// Stands in for the engine: the transcript, the clock, the settings, the
// store and the model. The model answers with the language it was asked for.
function engine(
  on: On,
  options: { messages?: () => Message[]; language?: string; answer?: (translation: string) => string } = {},
) {
  const asked: { prompt: string; system: string }[] = []
  const store = new Map<string, unknown>()
  on('session.messages', () => ({ value: (options.messages ?? (() => MESSAGES))() }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('clock.after', () => ({ value: undefined }))
  on('settings.read', () => ({ value: options.language === undefined ? {} : { language: options.language } }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)

    return { value: undefined }
  })
  on('model.complete', (_, e) => {
    const system = String(e.system)
    asked.push({ prompt: String(e.prompt), system })
    const text = system.includes('into English') ? 'EN-TEXT' : 'ZH-TEXT'

    // By default it echoes the <reply> wrapper and writes no <translation>
    // tags, as the model sometimes does: the mod strips the wrapper.
    const answer = options.answer ?? (translation => `<reply>\n${translation}\n</reply>`)

    return { value: { isAnswered: true, text: answer(text), usage: USAGE } }
  })
  // The engine draws a reply as `engine: <its text>`, so a test can tell
  // the reply from a translation drawn in its place.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const text = 'text' in e.props ? String(e.props.text) : ''

    return <Text>{`${DRAWN}${text}`}</Text>
  })

  return { asked, store }
}

const DRAWN = 'engine: '

type Mounted = Pick<Awaited<ReturnType<Parameters<TestBody>[0]['ui']['mount']>>, 'findAll'>

// The texts the engine draws: the reply's own, or a translation in its place.
async function drawn(ui: Mounted): Promise<string[]> {
  return (await ui.findAll({ type: 'Text', text: /^engine: / })).map(found => String(found.text).slice(DRAWN.length))
}

// Targets as a Chinese reader would set them; the defaults are `auto` and no
// main language.
const CHINESE_READER = { options: { languages: 'zh-CN, en' } }
const CHINESE_MAIN = { options: { languages: 'zh-CN, en', primaryLanguage: 'zh-CN' } }

test('an English reply offers Simplified Chinese, translates, hides and shows again', CHINESE_READER, async ($, on) => {
  const { asked, store } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const working = await $.ui.mount({ ...reply(WORKING), surface })
    expect(await working.find({ type: 'Button' })).toBeUndefined()
    await working.unmount()

    const final = await $.ui.mount({ ...reply(FINAL_EN), surface })
    const main = await final.find({ type: 'Button', text: /Simplified Chinese/ })
    expect(main?.props.label).toBe('Translate · Simplified Chinese')
    // The reply is English, so English is not offered.
    expect(await final.find({ type: 'Button', text: /English/ })).toBeUndefined()
    await final.unmount()
  }

  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(main?.key) })

  expect(asked).toHaveLength(1)
  expect(asked[0]?.prompt).toContain(FINAL_EN)
  expect(asked[0]?.system).toContain('into Simplified Chinese')
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('ZH-TEXT')
  expect(await ui.find({ type: 'Text', text: /Translation · Simplified Chinese/ })).toBeDefined()
  // By default the translation shows under the reply, which stays.
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()

  // Kept for later sessions.
  const kept = store.get(`t:${fingerprint(FINAL_EN)}`) as { texts: Record<string, string> } | undefined
  expect(kept?.texts['zh-Hans']).toBe('ZH-TEXT')

  const hide = await ui.find({ type: 'Button', text: /Hide translation/ })
  await ui.press({ key: String(hide?.key) })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()

  const show = await ui.find({ type: 'Button', text: /Show translation/ })
  await ui.press({ key: String(show?.key) })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('ZH-TEXT')
  expect(asked).toHaveLength(1)
  await ui.unmount()
})

test('a Chinese reply offers English; a Japanese one both, and a language seen before costs no call', CHINESE_READER, async ($, on) => {
  const { asked } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const chinese = await $.ui.mount({ ...reply(FINAL_ZH), surface: 'desktop' })
  expect((await chinese.find({ type: 'Button', text: /English/ }))?.props.label).toBe('Translate · English')
  expect(await chinese.find({ type: 'Button', text: /Simplified Chinese/ })).toBeUndefined()
  await chinese.unmount()

  const ui = await $.ui.mount({ ...reply(FINAL_JA), surface: 'desktop' })
  expect((await ui.find({ type: 'Button', text: /Simplified Chinese/ }))?.props.label).toBe(
    'Translate · Simplified Chinese',
  )
  const english = await ui.find({ type: 'Button', text: /English/ })
  expect(english?.props.label).toBe('English')

  await ui.press({ key: String(english?.key) })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('EN-TEXT')

  const toChinese = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(toChinese?.key) })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('ZH-TEXT')
  expect(asked).toHaveLength(2)

  const back = await ui.find({ type: 'Button', text: /English/ })
  await ui.press({ key: String(back?.key) })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('EN-TEXT')
  expect(asked).toHaveLength(2)
  await ui.unmount()
})

// With the defaults, the targets follow the button language too.
test("the buttons and the default targets follow Claude Code's language setting", async ($, on) => {
  engine(on, { language: 'chinese' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  expect((await ui.find({ type: 'Button' }))?.props.label).toBe('翻译 · 简体中文')
  await ui.unmount()
})

test('a translation kept by an earlier session shows without a call', async ($, on) => {
  const { asked, store } = engine(on)
  store.set(`t:${fingerprint(FINAL_EN)}`, {
    texts: { 'zh-Hans': 'KEPT' },
    language: 'zh-Hans',
    isHidden: false,
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('KEPT')
  expect(asked).toHaveLength(0)
  await ui.unmount()
})

test('with the defaults nothing is translated ahead of time', async ($, on) => {
  let messages = MESSAGES.slice(0, 3)
  const { asked } = engine(on, { messages: () => messages })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  messages = MESSAGES.slice(0, 4)
  await $.turn.complete({ answer: FINAL_EN, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  for (let i = 0; i < 20; i++) {
    await ui.find({ type: 'Button' })
  }
  expect(asked).toHaveLength(0)
  await ui.unmount()
})

test('a reply in another language is translated into the main language as its turn ends', CHINESE_MAIN, async ($, on) => {
  let messages = MESSAGES.slice(0, 3)
  const { asked } = engine(on, { messages: () => messages })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // The English reply ends its turn: translated ahead of time, not shown.
  messages = MESSAGES.slice(0, 4)
  await $.turn.complete({ answer: FINAL_EN, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  for (let i = 0; i < 50 && asked.length === 0; i++) {
    await ui.find({ type: 'Button' })
  }
  expect(asked).toHaveLength(1)
  expect(asked[0]?.system).toContain('into Simplified Chinese')
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()

  // Pressing shows it with no second call.
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  expect(main?.props.label).toBe('Translate · Simplified Chinese')
  await ui.press({ key: String(main?.key) })
  let shown = await ui.find({ type: 'Markdown' })
  for (let i = 0; i < 50 && shown === undefined; i++) {
    shown = await ui.find({ type: 'Markdown' })
  }
  expect(shown?.text).toBe('ZH-TEXT')
  expect(asked).toHaveLength(1)
  await ui.unmount()

  // A Chinese reply is in the main language already: nothing ahead of time.
  messages = MESSAGES.slice(0, 6)
  await $.turn.complete({ answer: FINAL_ZH, durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  const chinese = await $.ui.mount({ ...reply(FINAL_ZH), surface: 'desktop' })
  for (let i = 0; i < 20; i++) {
    await chinese.find({ type: 'Button' })
  }
  expect(asked).toHaveLength(1)
  await chinese.unmount()
})

test(
  'with autoExpand the main-language translation opens by itself as the turn ends',
  { options: { languages: 'zh-CN, en', primaryLanguage: 'zh-CN', autoExpand: true } },
  async ($, on) => {
    let messages = MESSAGES.slice(0, 3)
    const { asked, store } = engine(on, { messages: () => messages })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    messages = MESSAGES.slice(0, 4)
    await $.turn.complete({ answer: FINAL_EN, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    // The translation runs on a timer. Wait until it is kept, on another
    // drawing: in the kit, a write that lands while a drawing is being made
    // can miss its redraw, which this test is not about.
    const key = `t:${fingerprint(FINAL_EN)}`
    const waiting = await $.ui.mount({ ...reply(WORKING), surface: 'desktop' })
    for (let i = 0; i < 200 && !store.has(key); i++) {
      await waiting.find({ type: 'Text' })
    }
    await waiting.unmount()

    // Opened by itself: no press, and the translation shows.
    const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe('ZH-TEXT')
    expect(asked).toHaveLength(1)
    expect(await ui.find({ type: 'Button', text: /Hide translation/ })).toBeDefined()
    await ui.unmount()
  },
)

// Seen in use: the model wrote a remark about the text before translating it.
test('a remark the model writes around the <translation> tags is dropped', CHINESE_READER, async ($, on) => {
  const { asked } = engine(on, {
    answer: translation =>
      `The content in <reply> needs to be translated into Simplified Chinese.\n<translation>\n${translation}\n</translation>\nI kept the code unchanged.`,
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(main?.key) })

  expect(asked[0]?.system).toContain('<translation>')
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('ZH-TEXT')
  await ui.unmount()
})

test('a translation cut off before its closing tag keeps what it has', CHINESE_READER, async ($, on) => {
  engine(on, { answer: translation => `<translation>\n${translation}` })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(main?.key) })

  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('ZH-TEXT')
  await ui.unmount()
})

// The toolbar shows in the flow by default; with alwaysShowButtons off, on
// the desktop it sits in the hover strip, hidden until the pointer is over.
test('the buttons always show by default', CHINESE_READER, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.some(box => box.props.display === 'none')).toBe(false)
  expect(await ui.find({ type: 'Button', text: /Simplified Chinese/ })).toBeDefined()
  await ui.unmount()
})

test(
  'with alwaysShowButtons off the buttons wait for the pointer on the desktop',
  { options: { languages: 'zh-CN, en', alwaysShowButtons: false } },
  async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
    // The kit leaves `hover` out of the props it reports, so this checks the
    // hidden bar floating in its strip.
    const boxes = await ui.findAll({ type: 'Box' })
    const hidden = boxes.find(box => box.props.display === 'none')
    expect(hidden?.props.position).toBe('absolute')
    expect(boxes.some(box => box.props.height === 2)).toBe(true)
    expect(await ui.find({ type: 'Button', text: /Simplified Chinese/ })).toBeDefined()
    await ui.unmount()
  },
)

const REPLACING = { options: { languages: 'zh-CN, en', primaryLanguage: 'zh-CN', replaceOriginal: true } }

test('with replaceOriginal the main-language translation is made and takes the place of the reply, no press', REPLACING, async ($, on) => {
  let messages = MESSAGES.slice(0, 3)
  const { asked, store } = engine(on, { messages: () => messages })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  messages = MESSAGES.slice(0, 4)
  await $.turn.complete({ answer: FINAL_EN, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const key = `t:${fingerprint(FINAL_EN)}`
  const waiting = await $.ui.mount({ ...reply(WORKING), surface: 'desktop' })
  for (let i = 0; i < 200 && !store.has(key); i++) {
    await waiting.find({ type: 'Text' })
  }
  await waiting.unmount()

  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  expect(asked).toHaveLength(1)
  // The engine draws the translation in the reply's place, in its own style.
  expect(await drawn(ui)).toEqual(['ZH-TEXT'])
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /Show original/ })).toBeDefined()
  await ui.unmount()
})

// The reply shows in one language at a time: a translation into another
// language takes its place too, and switching back to the main language
// swaps the one in place.
test('with replaceOriginal a translation into another language takes the place of the reply too', REPLACING, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...reply(FINAL_JA), surface: 'desktop' })
  const english = await ui.find({ type: 'Button', text: /English/ })
  await ui.press({ key: String(english?.key) })

  expect(await drawn(ui)).toEqual(['EN-TEXT'])
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /Show original/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Hide translation/ })).toBeUndefined()

  const chinese = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(chinese?.key) })
  expect(await drawn(ui)).toEqual(['ZH-TEXT'])
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.unmount()
})

// Without a main language nothing is translated as a turn ends, but a
// translation that is asked for still takes the reply's place.
test(
  'replaceOriginal needs no main language for a translation that is asked for',
  { options: { languages: 'zh-CN, en', replaceOriginal: true } },
  async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
    const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
    await ui.press({ key: String(main?.key) })

    expect(await drawn(ui)).toEqual(['ZH-TEXT'])
    expect(await ui.find({ type: 'Button', text: /Show original/ })).toBeDefined()
    await ui.unmount()
  },
)

test('with replaceOriginal an open main-language translation takes the place of the reply', REPLACING, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(main?.key) })

  expect(await drawn(ui)).toEqual(['ZH-TEXT'])
  expect(await ui.find({ type: 'Text', text: /Translation · Simplified Chinese/ })).toBeDefined()

  // Showing the original puts the reply back and keeps the translation a
  // press away.
  const showOriginal = await ui.find({ type: 'Button', text: /Show original/ })
  await ui.press({ key: String(showOriginal?.key) })
  expect(await drawn(ui)).toEqual([FINAL_EN])
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /Show translation/ })).toBeDefined()
  await ui.unmount()
})

// Seen in use: asked for Simplified Chinese, the model handed a Japanese
// reply back unchanged, and it showed in the reply's place as if translated.
test('a translation still in the reply\'s own language is asked for once more', REPLACING, async ($, on) => {
  let calls = 0
  const { asked } = engine(on, {
    answer: translation => `<translation>\n${calls++ === 0 ? FINAL_JA : translation}\n</translation>`,
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...reply(FINAL_JA), surface: 'desktop' })
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(main?.key) })

  expect(asked).toHaveLength(2)
  expect(asked[0]?.system).toContain('written in Japanese')
  expect(asked[0]?.system).not.toContain('untranslated')
  expect(asked[1]?.system).toContain('untranslated')
  expect(await drawn(ui)).toEqual(['ZH-TEXT'])
  await ui.unmount()
})

test('a reply that keeps coming back untranslated shows an error and keeps nothing', REPLACING, async ($, on) => {
  const { asked, store } = engine(on, { answer: () => `<translation>\n${FINAL_JA}\n</translation>` })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...reply(FINAL_JA), surface: 'desktop' })
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(main?.key) })

  expect(asked).toHaveLength(2)
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /the reply came back untranslated/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Retry/ })).toBeDefined()
  expect(await drawn(ui)).toEqual([FINAL_JA])
  expect(store.has(`t:${fingerprint(FINAL_JA)}`)).toBe(false)
  await ui.unmount()
})

test('a kept translation still in the reply\'s own language is dropped and the reply offered afresh', REPLACING, async ($, on) => {
  const { asked, store } = engine(on)
  store.set(`t:${fingerprint(FINAL_JA)}`, { texts: { 'zh-Hans': FINAL_JA }, language: 'zh-Hans', isHidden: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...reply(FINAL_JA), surface: 'desktop' })
  // The kept text is the reply itself, so only the missing heading and Show
  // original button tell that it is not drawn in the reply's place.
  expect(await ui.find({ type: 'Text', text: /Translation ·/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /Show original/ })).toBeUndefined()
  expect(await drawn(ui)).toEqual([FINAL_JA])
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  expect(main?.props.label).toBe('Translate · Simplified Chinese')

  await ui.press({ key: String(main?.key) })
  expect(asked).toHaveLength(1)
  expect(await drawn(ui)).toEqual(['ZH-TEXT'])
  await ui.unmount()
})

const SKIPPING = { options: { languages: 'zh-CN, en', primaryLanguage: 'zh-CN', skipPrimaryReplies: true } }

test('with skipPrimaryReplies a reply in the main language is left as it is', SKIPPING, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // No buttons and no room for them: only the engine's own drawing.
  const chinese = await $.ui.mount({ ...reply(FINAL_ZH), surface: 'desktop' })
  expect(await chinese.find({ type: 'Button' })).toBeUndefined()
  expect(await chinese.findAll({ type: 'Box' })).toHaveLength(0)
  expect(await chinese.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await chinese.unmount()

  // A reply in another language still gets its buttons.
  const english = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  expect(await english.find({ type: 'Button', text: /Simplified Chinese/ })).toBeDefined()
  await english.unmount()
})

test('with skipPrimaryReplies a main-language reply keeps a translation it already has', SKIPPING, async ($, on) => {
  const { store } = engine(on)
  store.set(`t:${fingerprint(FINAL_ZH)}`, { texts: { en: 'KEPT' }, language: 'en', isHidden: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...reply(FINAL_ZH), surface: 'desktop' })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('KEPT')
  expect(await ui.find({ type: 'Button', text: /Hide translation/ })).toBeDefined()
  await ui.unmount()
})

const PART_ONE = 'First I changed the parser so that it reads the new field.'
const PART_TWO = 'Then I updated the tests, and they all pass now.'

// One final reply written as two text blocks.
const SPLIT: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'Do it' }] },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: PART_ONE },
      { type: 'text', text: PART_TWO },
    ],
  },
]

test('a reply of several blocks gets one set of buttons, under its last block, for the whole reply', CHINESE_READER, async ($, on) => {
  const { asked, store } = engine(on, { messages: () => SPLIT })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const first = await $.ui.mount({ ...reply(PART_ONE), surface: 'desktop' })
  expect(await first.find({ type: 'Button' })).toBeUndefined()
  expect(await drawn(first)).toEqual([PART_ONE])
  await first.unmount()

  const last = await $.ui.mount({ ...reply(PART_TWO), surface: 'desktop' })
  const main = await last.find({ type: 'Button', text: /Simplified Chinese/ })
  expect(main?.props.label).toBe('Translate · Simplified Chinese')
  await last.press({ key: String(main?.key) })

  expect(asked).toHaveLength(1)
  expect(asked[0]?.prompt).toContain(PART_ONE)
  expect(asked[0]?.prompt).toContain(PART_TWO)
  expect((await last.find({ type: 'Markdown' }))?.text).toBe('ZH-TEXT')
  const kept = store.get(`t:${fingerprint(`${PART_ONE}\n\n${PART_TWO}`)}`) as
    | { texts: Record<string, string> }
    | undefined
  expect(kept?.texts['zh-Hans']).toBe('ZH-TEXT')
  await last.unmount()
})

test('with replaceOriginal the earlier blocks of a reply give way to its translation', REPLACING, async ($, on) => {
  engine(on, { messages: () => SPLIT })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const last = await $.ui.mount({ ...reply(PART_TWO), surface: 'desktop' })
  const main = await last.find({ type: 'Button', text: /Simplified Chinese/ })
  await last.press({ key: String(main?.key) })
  expect(await drawn(last)).toEqual(['ZH-TEXT'])
  await last.unmount()

  const first = await $.ui.mount({ ...reply(PART_ONE), surface: 'desktop' })
  expect(await drawn(first)).toEqual([])
  await first.unmount()
})

test('a reply of several blocks is translated ahead of time in one call', CHINESE_MAIN, async ($, on) => {
  let messages = SPLIT.slice(0, 1)
  const { asked } = engine(on, { messages: () => messages })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  messages = SPLIT
  await $.turn.complete({
    answer: `${PART_ONE}\n\n${PART_TWO}`,
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })
  const last = await $.ui.mount({ ...reply(PART_TWO), surface: 'desktop' })
  for (let i = 0; i < 50 && asked.length === 0; i++) {
    await last.find({ type: 'Button' })
  }
  for (let i = 0; i < 20; i++) {
    await last.find({ type: 'Button' })
  }
  expect(asked).toHaveLength(1)
  expect(asked[0]?.prompt).toContain(PART_ONE)
  expect(asked[0]?.prompt).toContain(PART_TWO)
  await last.unmount()
})

test('a reply gets its buttons when the history arrives after session.start', CHINESE_READER, async ($, on) => {
  // A reopened session: the first read, at session.start, finds no history yet.
  let reads = 0
  engine(on, {
    messages: () => {
      reads += 1

      return reads === 1 ? [] : MESSAGES
    },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  let button = await ui.find({ type: 'Button', text: /Translate/ })
  for (let i = 0; i < 50 && button === undefined; i++) {
    button = await ui.find({ type: 'Button', text: /Translate/ })
  }

  expect(reads > 1).toBe(true)
  expect(button?.props.label).toBe('Translate · Simplified Chinese')
  await ui.unmount()
})
