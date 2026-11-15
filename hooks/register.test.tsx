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
function engine(on: On, options: { messages?: () => Message[]; language?: string } = {}) {
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

    // Echoes the wrapper, as the model sometimes does: the mod strips it.
    return { value: { isAnswered: true, text: `<reply>\n${text}\n</reply>`, usage: USAGE } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  return { asked, store }
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
    const { asked } = engine(on, { messages: () => messages })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    messages = MESSAGES.slice(0, 4)
    await $.turn.complete({ answer: FINAL_EN, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    const ui = await $.ui.mount({ ...reply(FINAL_EN), surface: 'desktop' })
    let shown = await ui.find({ type: 'Markdown' })
    for (let i = 0; i < 50 && shown === undefined; i++) {
      shown = await ui.find({ type: 'Markdown' })
    }

    expect(shown?.text).toBe('ZH-TEXT')
    expect(asked).toHaveLength(1)
    expect(await ui.find({ type: 'Button', text: /Hide translation/ })).toBeDefined()
    await ui.unmount()
  },
)

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
