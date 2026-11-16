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
  on('tool.call', () => ({ result: {} }))
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

// A translation as the engine draws it in the reply's place: a mark for what
// it was translated from ends its last line.
const replaced = (text: string, from: string) => `${text} *(translated from ${from})*`

// The name on the button marked as what the reply, or the band, shows now:
// the one checked and not drawn dim.
async function marked(ui: Mounted): Promise<string | undefined> {
  const found = (await ui.findAll({ type: 'Button' })).filter(button => button.props.dimColor !== true)
  const checked = found.filter(button => String(button.props.label).startsWith('✓ '))
  expect(checked).toHaveLength(found.length)

  return found[0] === undefined ? undefined : String(found[0].props.label).slice(2)
}

// The names on the buttons, the check left out.
async function labels(ui: Mounted): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(button => String(button.props.label).replace(/^✓ /, ''))
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
    expect(main?.props.label).toBe('Simplified Chinese')
    expect(await marked(final)).toBe('Original')
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

  // The buttons mark what the reply shows, Original or a language, with a
  // check on it.
  expect(await marked(ui)).toBe('Simplified Chinese')
  expect((await ui.find({ type: 'Button', text: /Simplified Chinese/ }))?.props.label).toBe('✓ Simplified Chinese')
  const original = await ui.find({ type: 'Button', text: /^(✓ )?Original$/ })
  await ui.press({ key: String(original?.key) })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await marked(ui)).toBe('Original')

  const again = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(again?.key) })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('ZH-TEXT')
  expect(await marked(ui)).toBe('Simplified Chinese')
  expect(asked).toHaveLength(1)
  await ui.unmount()
})

test('a Chinese reply offers English; a Japanese one both, and a language seen before costs no call', CHINESE_READER, async ($, on) => {
  const { asked } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const chinese = await $.ui.mount({ ...reply(FINAL_ZH), surface: 'desktop' })
  expect((await chinese.find({ type: 'Button', text: /English/ }))?.props.label).toBe('English')
  expect(await chinese.find({ type: 'Button', text: /Simplified Chinese/ })).toBeUndefined()
  await chinese.unmount()

  const ui = await $.ui.mount({ ...reply(FINAL_JA), surface: 'desktop' })
  expect((await ui.find({ type: 'Button', text: /Simplified Chinese/ }))?.props.label).toBe('Simplified Chinese')
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
  expect(await labels(ui)).toEqual(['原文', '简体中文'])
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
  expect(main?.props.label).toBe('Simplified Chinese')
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
    expect(await marked(ui)).toBe('Simplified Chinese')
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
  expect(await drawn(ui)).toEqual([replaced('ZH-TEXT', 'English')])
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await marked(ui)).toBe('Simplified Chinese')
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

  expect(await drawn(ui)).toEqual([replaced('EN-TEXT', 'Japanese')])
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await marked(ui)).toBe('English')

  const chinese = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(chinese?.key) })
  expect(await drawn(ui)).toEqual([replaced('ZH-TEXT', 'Japanese')])
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await marked(ui)).toBe('Simplified Chinese')
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

    expect(await drawn(ui)).toEqual([replaced('ZH-TEXT', 'English')])
    expect(await marked(ui)).toBe('Simplified Chinese')
    await ui.unmount()
  },
)

test('with replaceOriginal an open main-language translation takes the place of the reply', REPLACING, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(main?.key) })

  expect(await drawn(ui)).toEqual([replaced('ZH-TEXT', 'English')])
  expect(await ui.find({ type: 'Text', text: /Translation ·/ })).toBeUndefined()

  // Original puts the reply back and keeps the translation a press away.
  const original = await ui.find({ type: 'Button', text: /^(✓ )?Original$/ })
  await ui.press({ key: String(original?.key) })
  expect(await drawn(ui)).toEqual([FINAL_EN])
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await marked(ui)).toBe('Original')
  await ui.unmount()
})

// The mark stays on the translation's last line, where it can: after a code
// block it takes a paragraph of its own, and in Chinese it needs no space.
test('a translation in the reply\'s place ends with a mark for what it was translated from', REPLACING, async ($, on) => {
  engine(on, { answer: translation => `<translation>\n${translation}\n\n\`\`\`sh\nnpm test\n\`\`\`\n</translation>` })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(main?.key) })
  expect(await drawn(ui)).toEqual(['ZH-TEXT\n\n```sh\nnpm test\n```\n\n*(translated from English)*'])
  await ui.unmount()
})

test(
  'the mark is written in the interface language',
  { options: { languages: 'zh-CN, en', primaryLanguage: 'zh-CN', replaceOriginal: true, uiLanguage: 'zh-CN' } },
  async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
    const main = await ui.find({ type: 'Button', text: /简体中文/ })
    await ui.press({ key: String(main?.key) })
    expect(await drawn(ui)).toEqual(['ZH-TEXT*（翻译自英语）*'])
    await ui.unmount()
  },
)

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
  expect(await drawn(ui)).toEqual([replaced('ZH-TEXT', 'Japanese')])
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
  expect(await ui.find({ type: 'Button', text: /\u21BB/ })).toBeDefined()
  expect(await drawn(ui)).toEqual([FINAL_JA])
  expect(store.has(`t:${fingerprint(FINAL_JA)}`)).toBe(false)
  await ui.unmount()
})

test('a kept translation still in the reply\'s own language is dropped and the reply offered afresh', REPLACING, async ($, on) => {
  const { asked, store } = engine(on)
  store.set(`t:${fingerprint(FINAL_JA)}`, { texts: { 'zh-Hans': FINAL_JA }, language: 'zh-Hans', isHidden: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...reply(FINAL_JA), surface: 'desktop' })
  // The kept text is the reply itself, so only the missing heading and the
  // Original mark tell that it is not drawn in the reply's place.
  expect(await ui.find({ type: 'Text', text: /Translation ·/ })).toBeUndefined()
  expect(await marked(ui)).toBe('Original')
  expect(await drawn(ui)).toEqual([FINAL_JA])
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  expect(main?.props.label).toBe('Simplified Chinese')

  await ui.press({ key: String(main?.key) })
  expect(asked).toHaveLength(1)
  expect(await drawn(ui)).toEqual([replaced('ZH-TEXT', 'Japanese')])
  await ui.unmount()
})

// A long English reply, long enough to be held to the length check.
const LONG_EN = Array.from(
  { length: 6 },
  (_, i) => `Step ${i + 1} of the fix rewrites the parser so that it reads the new field before the old one.`,
).join(' ')
const LONG_ZH = '修复解析器'.repeat(30)
const LONG_TURN: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'Explain the fix' }] },
  { role: 'assistant', content: [{ type: 'text', text: LONG_EN }] },
]
// Seen in use: Haiku's answer to a long note, a remark and no translation.
const REMARK = '<reply>的翻译如下。由于原文是英文，需逐句翻译。'

test('a translation far shorter than the reply is asked for once more', CHINESE_READER, async ($, on) => {
  let calls = 0
  const { asked } = engine(on, {
    messages: () => LONG_TURN,
    answer: () => (calls++ === 0 ? REMARK : `<translation>\n${LONG_ZH}\n</translation>`),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...reply(LONG_EN), surface: 'desktop' })
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(main?.key) })

  expect(asked).toHaveLength(2)
  expect(asked[0]?.system).not.toContain('no full translation')
  expect(asked[1]?.system).toContain('no full translation')
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(LONG_ZH)
  await ui.unmount()
})

test('a translation that keeps coming back far too short shows an error, and \u21BB asks again', CHINESE_READER, async ($, on) => {
  let isFixed = false
  const { asked, store } = engine(on, {
    messages: () => LONG_TURN,
    answer: () => (isFixed ? `<translation>\n${LONG_ZH}\n</translation>` : REMARK),
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...reply(LONG_EN), surface: 'desktop' })
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(main?.key) })

  expect(asked).toHaveLength(2)
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /the translation came back incomplete/ })).toBeDefined()
  expect(store.has(`t:${fingerprint(LONG_EN)}`)).toBe(false)

  isFixed = true
  const refresh = await ui.find({ type: 'Button', text: /\u21BB/ })
  await ui.press({ key: String(refresh?.key) })
  expect(asked).toHaveLength(3)
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(LONG_ZH)
  expect(await marked(ui)).toBe('Simplified Chinese')
  await ui.unmount()
})

test('a kept translation far shorter than the reply is dropped and the reply offered afresh', CHINESE_READER, async ($, on) => {
  const { asked, store } = engine(on, { messages: () => LONG_TURN })
  store.set(`t:${fingerprint(LONG_EN)}`, { texts: { 'zh-Hans': '的翻译如下。' }, language: 'zh-Hans', isHidden: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...reply(LONG_EN), surface: 'desktop' })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await marked(ui)).toBe('Original')
  expect(asked).toHaveLength(0)
  await ui.unmount()
})

// ↻ over an open translation asks the model again, for one that came out
// wrong; under the original there is nothing to make again.
test('\u21BB under an open translation makes it again', CHINESE_READER, async ($, on) => {
  const { asked } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  expect(await ui.find({ type: 'Button', text: /\u21BB/ })).toBeUndefined()
  const main = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  await ui.press({ key: String(main?.key) })
  expect(asked).toHaveLength(1)

  const refresh = await ui.find({ type: 'Button', text: /\u21BB/ })
  await ui.press({ key: String(refresh?.key) })
  expect(asked).toHaveLength(2)
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('ZH-TEXT')
  expect(await marked(ui)).toBe('Simplified Chinese')

  const original = await ui.find({ type: 'Button', text: /^(\u2713 )?Original$/ })
  await ui.press({ key: String(original?.key) })
  expect(await ui.find({ type: 'Button', text: /\u21BB/ })).toBeUndefined()
  await ui.unmount()
})

// The band above the prompt, as the main conversation's view draws it.
const band = {
  plugin: 'reply-translate',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

// A note between tool calls draws no buttons: its turn's final reply has
// them, and they act on the note too. Without replaceOriginal the note's
// translation opens under it, as the reply's does.
test(
  "with translateAll a note goes with its turn's final reply",
  { options: { languages: 'zh-CN, en', translateAll: true } },
  async ($, on) => {
    const { asked } = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    const before = await $.ui.mount({ ...reply(WORKING), surface: 'desktop' })
    expect(await before.find({ type: 'Button' })).toBeUndefined()
    expect(await drawn(before)).toEqual([WORKING])
    await before.unmount()

    const final = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
    const main = await final.find({ type: 'Button', text: /Simplified Chinese/ })
    expect(main?.props.label).toBe('Simplified Chinese')
    await final.press({ key: String(main?.key) })
    expect(asked).toHaveLength(2)
    const prompts = asked.map(call => call.prompt).join('\n')
    expect(prompts).toContain(WORKING)
    expect(prompts).toContain(FINAL_EN)
    expect((await final.find({ type: 'Markdown' }))?.text).toBe('ZH-TEXT')

    const note = await $.ui.mount({ ...reply(WORKING), surface: 'desktop' })
    expect((await note.find({ type: 'Markdown' }))?.text).toBe('ZH-TEXT')
    expect(await drawn(note)).toEqual([WORKING])
    expect(await note.find({ type: 'Button' })).toBeUndefined()
    await note.unmount()

    // Original on the reply hides the note's translation too.
    const hide = await final.find({ type: 'Button', text: /^(✓ )?Original$/ })
    await final.press({ key: String(hide?.key) })
    const hidden = await $.ui.mount({ ...reply(WORKING), surface: 'desktop' })
    expect(await hidden.find({ type: 'Markdown' })).toBeUndefined()
    await hidden.unmount()
    await final.unmount()
  },
)

const NOTE = 'Now I will check the logs for the failing test.'
const FINAL_NEXT = 'The logs are clean, and the test passes now.'

// A fourth turn: a note before a tool call, then the final reply.
const NEXT_TURN: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'Check the logs' }] },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: NOTE },
      { type: 'tool_use', id: 't2', name: 'Read', input: {} },
    ],
  },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] },
  { role: 'assistant', content: [{ type: 'text', text: FINAL_NEXT }] },
]

// The history arrives only as the fourth turn ends, so every unit is new to
// the mod then; only the fourth turn's are translated, the rest wait.
test(
  'with translateAll only the latest turn is translated as it ends',
  { options: { languages: 'zh-CN, en', primaryLanguage: 'zh-CN', replaceOriginal: true, translateAll: true } },
  async ($, on) => {
    let messages: Message[] = []
    const { asked, store } = engine(on, { messages: () => messages })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    messages = [...MESSAGES, ...NEXT_TURN]
    await $.turn.complete({ answer: FINAL_NEXT, durationMs: 1, isAborted: false, turnId: 't4', reason: 'answer' })
    const keys = [NOTE, FINAL_NEXT].map(text => `t:${fingerprint(text)}`)
    const waiting = await $.ui.mount({ ...reply(FINAL_ZH), surface: 'desktop' })
    for (let i = 0; i < 200 && !keys.every(key => store.has(key)); i++) {
      await waiting.find({ type: 'Text' })
    }
    await waiting.unmount()

    expect(asked).toHaveLength(2)
    const prompts = asked.map(call => call.prompt).join('\n')
    expect(prompts).toContain(NOTE)
    expect(prompts).toContain(FINAL_NEXT)
    expect(prompts).not.toContain(WORKING)
    expect(prompts).not.toContain(FINAL_EN)

    const note = await $.ui.mount({ ...reply(NOTE), surface: 'desktop' })
    expect(await drawn(note)).toEqual([replaced('ZH-TEXT', 'English')])
    await note.unmount()
    // An earlier turn's note waits for a press on its turn's reply.
    const working = await $.ui.mount({ ...reply(WORKING), surface: 'desktop' })
    expect(await drawn(working)).toEqual([WORKING])
    expect(await working.find({ type: 'Button' })).toBeUndefined()
    await working.unmount()
    const first = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
    expect(await first.find({ type: 'Button', text: /Simplified Chinese/ })).toBeDefined()
    await first.unmount()
  },
)

// Thinking the desktop shows as text: a narration signature and its text.
const NARRATION = 'Two windows are running against each other, so I am stopping mine.'
const NARRATED = 'EgluYXJyYXRpb24SDHh5eg=='
const HIDDEN = 'EglzdW1tYXJ5eHgSDHh5eg=='
const THOUGHT = 'I should check which process holds the port before stopping it.'

const NARRATED_TURN: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'Fix the bot' }] },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '', signature: HIDDEN },
      { type: 'thinking', thinking: THOUGHT, signature: HIDDEN },
      { type: 'thinking', thinking: `${NARRATION}\n\n`, signature: NARRATED },
      { type: 'tool_use', id: 't5', name: 'Bash', input: {} },
    ],
  },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't5', content: 'ok' }] },
  { role: 'assistant', content: [{ type: 'text', text: FINAL_NEXT }] },
]

// Seen in use: models write notes as thinking the desktop shows as text. The
// desktop draws them itself, out of the mod's reach, so no thinking is
// translated: it would cost a call for a translation nobody sees.
test(
  'with translateAll thinking is not translated, even thinking the desktop shows',
  { options: { languages: 'zh-CN, en', translateAll: true } },
  async ($, on) => {
    const { asked } = engine(on, { messages: () => NARRATED_TURN })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    const note = await $.ui.mount({ ...reply(NARRATION), surface: 'desktop' })
    expect(await note.find({ type: 'Button' })).toBeUndefined()
    await note.unmount()

    const final = await $.ui.mount({ ...reply(FINAL_NEXT), surface: 'desktop' })
    const main = await final.find({ type: 'Button', text: /Simplified Chinese/ })
    await final.press({ key: String(main?.key) })
    const prompts = asked.map(call => call.prompt).join('\n')
    expect(asked).toHaveLength(1)
    expect(prompts).toContain(FINAL_NEXT)
    expect(prompts).not.toContain(NARRATION)
    expect(prompts).not.toContain(THOUGHT)
    await final.unmount()
  },
)

// A long turn: its note is translated once the call after it starts, not
// only when the turn ends.
test(
  'with translateAll a note is translated as the next tool call starts',
  { options: { languages: 'zh-CN, en', primaryLanguage: 'zh-CN', replaceOriginal: true, translateAll: true } },
  async ($, on) => {
    let messages: Message[] = [...MESSAGES]
    const { asked, store } = engine(on, { messages: () => messages })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    // The turn has its note and a call so far, and no reply yet.
    messages = [...MESSAGES, ...NEXT_TURN.slice(0, 2)]
    await $.tool.call({ tool: 'Read', file_path: '/logs/test.log' })
    const key = `t:${fingerprint(NOTE)}`
    const waiting = await $.ui.mount({ ...reply(FINAL_ZH), surface: 'desktop' })
    for (let i = 0; i < 200 && !store.has(key); i++) {
      await waiting.find({ type: 'Text' })
    }
    await waiting.unmount()

    expect(asked).toHaveLength(1)
    expect(asked[0]?.prompt).toContain(NOTE)
    const note = await $.ui.mount({ ...reply(NOTE), surface: 'desktop' })
    expect(await drawn(note)).toEqual([replaced('ZH-TEXT', 'English')])
    expect(await note.find({ type: 'Button' })).toBeUndefined()
    await note.unmount()
  },
)

const FINAL_ZH_NEXT = '日志都正常，测试现在也通过了。'

// A turn of English notes ending in a Chinese reply, as Claude often writes
// for a Chinese reader.
const MIXED_TURN: Message[] = [
  { role: 'user', content: [{ type: 'text', text: '看下日志' }] },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: NOTE },
      { type: 'tool_use', id: 't3', name: 'Read', input: {} },
    ],
  },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3', content: 'ok' }] },
  { role: 'assistant', content: [{ type: 'text', text: FINAL_ZH_NEXT }] },
]

// The reply is in the main language, but its turn's note is not: the reply
// keeps buttons for the turn, and they switch the note.
test(
  'a Chinese reply with English notes keeps the buttons for its turn',
  {
    options: {
      languages: 'zh-CN, en',
      primaryLanguage: 'zh-CN',
      replaceOriginal: true,
      skipPrimaryReplies: true,
      translateAll: true,
    },
  },
  async ($, on) => {
    let messages: Message[] = [...MESSAGES]
    const { asked, store } = engine(on, { messages: () => messages })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    messages = [...MESSAGES, ...MIXED_TURN]
    await $.turn.complete({ answer: FINAL_ZH_NEXT, durationMs: 1, isAborted: false, turnId: 't4', reason: 'answer' })
    const key = `t:${fingerprint(NOTE)}`
    const waiting = await $.ui.mount({ ...reply(FINAL_ZH), surface: 'desktop' })
    for (let i = 0; i < 200 && !store.has(key); i++) {
      await waiting.find({ type: 'Text' })
    }
    await waiting.unmount()
    // Only the note: the reply is Chinese already.
    expect(asked).toHaveLength(1)

    const note = await $.ui.mount({ ...reply(NOTE), surface: 'desktop' })
    expect(await drawn(note)).toEqual([replaced('ZH-TEXT', 'English')])
    expect(await note.find({ type: 'Button' })).toBeUndefined()
    await note.unmount()

    const final = await $.ui.mount({ ...reply(FINAL_ZH_NEXT), surface: 'desktop' })
    expect(await drawn(final)).toEqual([FINAL_ZH_NEXT])
    expect(await final.find({ type: 'Text', text: /Translation ·/ })).toBeUndefined()
    // The turn reads in Chinese: its note shows the translation.
    expect(await marked(final)).toBe('Simplified Chinese')
    expect(await labels(final)).toEqual(['Original', 'Simplified Chinese', 'English', '\u21BB'])
    const showOriginal = await final.find({ type: 'Button', text: /^(✓ )?Original$/ })
    await final.press({ key: String(showOriginal?.key) })
    const original = await $.ui.mount({ ...reply(NOTE), surface: 'desktop' })
    expect(await drawn(original)).toEqual([NOTE])
    await original.unmount()
    expect(await marked(final)).toBe('Original')

    // English for the turn: the reply is translated, the note is English.
    const english = await final.find({ type: 'Button', text: /English/ })
    await final.press({ key: String(english?.key) })
    expect(asked).toHaveLength(2)
    expect(await drawn(final)).toEqual([replaced('EN-TEXT', 'Chinese')])
    const inEnglish = await $.ui.mount({ ...reply(NOTE), surface: 'desktop' })
    expect(await drawn(inEnglish)).toEqual([NOTE])
    await inEnglish.unmount()
    expect(await marked(final)).toBe('English')

    // Seen in use: a turn put in English, shown as written and then shown
    // again, came back with the note in Chinese and the reply in English. A
    // press on a language puts the whole turn in it, from what was kept.
    const hide = await final.find({ type: 'Button', text: /^(✓ )?Original$/ })
    await final.press({ key: String(hide?.key) })
    expect(await drawn(final)).toEqual([FINAL_ZH_NEXT])
    expect(await marked(final)).toBe('Original')
    const chinese = await final.find({ type: 'Button', text: /Simplified Chinese/ })
    await final.press({ key: String(chinese?.key) })
    expect(asked).toHaveLength(2)
    expect(await drawn(final)).toEqual([FINAL_ZH_NEXT])
    const inChinese = await $.ui.mount({ ...reply(NOTE), surface: 'desktop' })
    expect(await drawn(inChinese)).toEqual([replaced('ZH-TEXT', 'English')])
    await inChinese.unmount()
    expect(await marked(final)).toBe('Simplified Chinese')
    // The buttons stay put: Original and both languages, whatever it shows,
    // and ↻ while a translation is open.
    expect(await labels(final)).toEqual(['Original', 'Simplified Chinese', 'English', '\u21BB'])
    await final.unmount()
  },
)

// The band counts replies, not notes, and acts on whole turns.
test(
  'with translateAll the band counts replies and translates their notes too',
  { options: { languages: 'zh-CN, en', primaryLanguage: 'zh-CN', replaceOriginal: true, translateAll: true } },
  async ($, on) => {
    const { asked } = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    const row = await $.ui.mount(band)
    expect(await row.find({ type: 'Text', text: /Last 3 replies/ })).toBeDefined()
    const showAll = await row.find({ type: 'Button', text: /Simplified Chinese/ })
    await row.press({ key: String(showAll?.key) })
    expect(asked).toHaveLength(3)
    const note = await $.ui.mount({ ...reply(WORKING), surface: 'desktop' })
    expect(await drawn(note)).toEqual([replaced('ZH-TEXT', 'English')])
    await note.unmount()
    await row.unmount()
  },
)


test('the band above the prompt shows and hides the translations of the last replies at once', REPLACING, async ($, on) => {
  const { asked } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const row = await $.ui.mount(band)
  expect(await row.find({ type: 'Text', text: /Last 3 replies/ })).toBeDefined()
  const showAll = await row.find({ type: 'Button', text: /Simplified Chinese/ })
  await row.press({ key: String(showAll?.key) })

  // The English and the Japanese reply are translated into the main
  // language; the Chinese one is in it already.
  expect(asked).toHaveLength(2)
  // Every recent turn reads in Chinese now, the Chinese one as written.
  expect(await marked(row)).toBe('Simplified Chinese')
  for (const [text, from] of [[FINAL_EN, 'English'], [FINAL_JA, 'Japanese']] as const) {
    const ui = await $.ui.mount({ ...reply(text), surface: 'desktop' })
    expect(await drawn(ui)).toEqual([replaced('ZH-TEXT', from)])
    await ui.unmount()
  }
  const chinese = await $.ui.mount({ ...reply(FINAL_ZH), surface: 'desktop' })
  expect(await drawn(chinese)).toEqual([FINAL_ZH])
  await chinese.unmount()

  const showOriginals = await row.find({ type: 'Button', text: /^(✓ )?Original$/ })
  await row.press({ key: String(showOriginals?.key) })
  expect(await marked(row)).toBe('Original')
  const english = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  expect(await drawn(english)).toEqual([FINAL_EN])
  expect(await marked(english)).toBe('Original')
  await english.unmount()

  // Shown again from what was kept: no call.
  await row.press({ key: String(showAll?.key) })
  expect(asked).toHaveLength(2)
  const again = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
  expect(await drawn(again)).toEqual([replaced('ZH-TEXT', 'English')])
  await again.unmount()
  expect(await marked(row)).toBe('Simplified Chinese')

  // One reply put in English on its own: the turns differ, so the band marks
  // nothing.
  const japanese = await $.ui.mount({ ...reply(FINAL_JA), surface: 'desktop' })
  const toEnglish = await japanese.find({ type: 'Button', text: /English/ })
  await japanese.press({ key: String(toEnglish?.key) })
  expect(await marked(japanese)).toBe('English')
  await japanese.unmount()
  expect(await marked(row)).toBeUndefined()
  await row.unmount()
})

// Seen in use: with only Chinese replies in range, Simplified Chinese on the
// band did nothing. It offers only the languages a recent reply can be put in.
test('the band offers only the languages the recent replies can be put in', REPLACING, async ($, on) => {
  const { asked } = engine(on, { messages: () => MESSAGES.slice(4, 6) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const row = await $.ui.mount(band)
  expect(await row.find({ type: 'Text', text: /Last reply/ })).toBeDefined()
  expect(await labels(row)).toEqual(['Original', 'English'])
  expect(await marked(row)).toBe('Original')
  const english = await row.find({ type: 'Button', text: /English/ })
  await row.press({ key: String(english?.key) })
  expect(asked).toHaveLength(1)
  expect(await marked(row)).toBe('English')
  await row.unmount()
})

test(
  'the band acts on no more replies than controlRange',
  { options: { languages: 'zh-CN, en', primaryLanguage: 'zh-CN', replaceOriginal: true, controlRange: 1 } },
  async ($, on) => {
    const { asked } = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    const row = await $.ui.mount(band)
    expect(await row.find({ type: 'Text', text: /Last reply/ })).toBeDefined()
    const showAll = await row.find({ type: 'Button', text: /Simplified Chinese/ })
    await row.press({ key: String(showAll?.key) })

    expect(asked).toHaveLength(1)
    expect(asked[0]?.prompt).toContain(FINAL_JA)
    const english = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
    expect(await drawn(english)).toEqual([FINAL_EN])
    await english.unmount()
    await row.unmount()
  },
)

// Without a main language every reply gets its main target, and the
// translations open under the replies.
test('without replaceOriginal the band opens and hides translations under the replies', CHINESE_READER, async ($, on) => {
  const { asked } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const row = await $.ui.mount(band)
  expect(await labels(row)).toEqual(['Original', 'Simplified Chinese', 'English'])
  expect(await marked(row)).toBe('Original')
  // English for all: the Chinese and the Japanese reply are translated, the
  // English one is in it already.
  const english = await row.find({ type: 'Button', text: /English/ })
  await row.press({ key: String(english?.key) })
  expect(asked).toHaveLength(2)
  expect(await marked(row)).toBe('English')

  const chinese = await $.ui.mount({ ...reply(FINAL_ZH), surface: 'desktop' })
  expect((await chinese.find({ type: 'Markdown' }))?.text).toBe('EN-TEXT')
  expect(await drawn(chinese)).toEqual([FINAL_ZH])
  await chinese.unmount()

  const hideAll = await row.find({ type: 'Button', text: /^(✓ )?Original$/ })
  await row.press({ key: String(hideAll?.key) })
  const hidden = await $.ui.mount({ ...reply(FINAL_ZH), surface: 'desktop' })
  expect(await hidden.find({ type: 'Markdown' })).toBeUndefined()
  await hidden.unmount()
  expect(await marked(row)).toBe('Original')
  await row.unmount()
})

test('controlRange 0 draws no band', { options: { languages: 'zh-CN, en', controlRange: 0 } }, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const row = await $.ui.mount(band)
  expect(await row.find({ type: 'Button' })).toBeUndefined()
  await row.unmount()
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
  expect(await marked(ui)).toBe('English')
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
  expect(main?.props.label).toBe('Simplified Chinese')
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
  expect(await drawn(last)).toEqual([replaced('ZH-TEXT', 'English')])
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
  let button = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  for (let i = 0; i < 50 && button === undefined; i++) {
    button = await ui.find({ type: 'Button', text: /Simplified Chinese/ })
  }

  expect(reads > 1).toBe(true)
  expect(button?.props.label).toBe('Simplified Chinese')
  await ui.unmount()
})
