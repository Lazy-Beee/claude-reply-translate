import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Group, Reply } from '../types'

const MAX_FINALS = 1000

// What `languages` falls back to when none of its entries reads as a language.
const FALLBACK_TARGETS = 'en'

// No main language unless the person sets one: translating ahead of time costs
// a model call per reply.
const DEFAULT_PRIMARY = ''

// A reopened session can load its transcript after session.start has run, so
// the history is read again this many milliseconds after start.
const RESCAN_MS = [1000, 3000, 10000]

// Translations are kept in $.store between sessions, the oldest dropped past
// this many bytes of JSON (the store holds 4 MiB in all).
const STORE_BUDGET = 2_000_000
const STORE_INDEX = 'index'

// The height, in rows of the code font, of the strip that holds the buttons
// shown on hover: the strip always takes its room, so showing them moves
// nothing.
const HOVER_STRIP_ROWS = 2

const finals = atom({ plugin: 'reply-translate', key: 'finals' } as const, [], {
  shape: 'finals-1',
})

// The blocks of the final replies made of several: which reply each belongs
// to and whether it is the last, which draws the buttons and holds the text.
const groups = atom({ plugin: 'reply-translate', key: 'groups' } as const, {}, {
  shape: 'groups-1',
})

const uiLocale = { plugin: 'reply-translate', key: 'uiLocale' } as const

const replies = { plugin: 'reply-translate', key: 'replies' } as const

// A language to translate into.
type Target = {
  // The canonical tag (`zh-Hans`, `en`), or the name as written.
  key: string
  // The base language (`zh`, `en`); absent for a name that is no tag.
  family?: string
  // How the model is told the language.
  promptName: string
}

type Settings = {
  model: string
  // As configured, or `auto`: worked out per drawing from the button language.
  targets: Target[] | 'auto'
  // The person's own language: replies in another one are translated into
  // it ahead of time, as each turn ends.
  primary?: Target
  // Open the main-language translation by itself as each turn ends, rather
  // than keep it until the person presses.
  autoExpand: boolean
  // An open translation, in any language, takes the place of the reply;
  // hiding it shows the original again. With a main language, the
  // translation into it is made as each turn ends, no press needed.
  replaceOriginal: boolean
  // A reply already in the main language is drawn as it is: no buttons, no
  // room kept for them.
  skipPrimaryReplies: boolean
  uiLanguage: string
  showOnHover: boolean
}

// Replies shorter than this, normalized, are not translated ahead of time.
const PREFETCH_MIN_CHARS = 12

type StoredReply = { texts: Record<string, string>; language?: string; isHidden: boolean }

type Surface = Parameters<EngineInterface['ui']['copy']>[0]['surface']

// ---- Strings of the buttons, in the languages the buttons can be drawn in.

type Strings = {
  translate: string
  translating: string
  translation: string
  hide: string
  show: string
  showOriginal: string
  copy: string
  copied: string
  retry: string
  failed: string
  reasons: Record<string, string>
}

const EN: Strings = {
  translate: 'Translate',
  translating: 'Translating',
  translation: 'Translation',
  hide: 'Hide translation',
  show: 'Show translation',
  showOriginal: 'Show original',
  copy: 'Copy',
  copied: 'Translation copied',
  retry: 'Retry',
  failed: 'Translation failed: {reason}',
  reasons: {
    'api-error': 'API error',
    'empty-reply': 'empty reply',
    aborted: 'timed out or cancelled',
    untranslated: 'the reply came back untranslated',
  },
}

const STRINGS: Record<string, Strings> = {
  en: EN,
  'zh-Hans': {
    translate: '翻译',
    translating: '正在翻译',
    translation: '译文',
    hide: '隐藏译文',
    show: '显示译文',
    showOriginal: '显示原文',
    copy: '复制',
    copied: '已复制译文',
    retry: '重试',
    failed: '翻译失败：{reason}',
    reasons: {
      'api-error': '接口出错',
      'empty-reply': '返回为空',
      aborted: '超时或已取消',
      untranslated: '返回的仍是原文',
    },
  },
  'zh-Hant': {
    translate: '翻譯',
    translating: '正在翻譯',
    translation: '譯文',
    hide: '隱藏譯文',
    show: '顯示譯文',
    showOriginal: '顯示原文',
    copy: '複製',
    copied: '已複製譯文',
    retry: '重試',
    failed: '翻譯失敗：{reason}',
    reasons: {
      'api-error': '介面出錯',
      'empty-reply': '回應為空',
      aborted: '逾時或已取消',
      untranslated: '回傳的仍是原文',
    },
  },
  ja: {
    translate: '翻訳',
    translating: '翻訳中',
    translation: '訳文',
    hide: '訳文を隠す',
    show: '訳文を表示',
    showOriginal: '原文を表示',
    copy: 'コピー',
    copied: '訳文をコピーしました',
    retry: '再試行',
    failed: '翻訳に失敗しました：{reason}',
    reasons: {
      'api-error': 'API エラー',
      'empty-reply': '空の応答',
      aborted: 'タイムアウトまたはキャンセル',
      untranslated: '原文のまま返されました',
    },
  },
  ko: {
    translate: '번역',
    translating: '번역 중',
    translation: '번역문',
    hide: '번역 숨기기',
    show: '번역 보기',
    showOriginal: '원문 보기',
    copy: '복사',
    copied: '번역문을 복사했습니다',
    retry: '다시 시도',
    failed: '번역 실패: {reason}',
    reasons: {
      'api-error': 'API 오류',
      'empty-reply': '빈 응답',
      aborted: '시간 초과 또는 취소됨',
      untranslated: '원문 그대로 반환됨',
    },
  },
  es: {
    translate: 'Traducir',
    translating: 'Traduciendo',
    translation: 'Traducción',
    hide: 'Ocultar traducción',
    show: 'Mostrar traducción',
    showOriginal: 'Mostrar original',
    copy: 'Copiar',
    copied: 'Traducción copiada',
    retry: 'Reintentar',
    failed: 'Error al traducir: {reason}',
    reasons: {
      'api-error': 'error de la API',
      'empty-reply': 'respuesta vacía',
      aborted: 'tiempo agotado o cancelado',
      untranslated: 'la respuesta volvió sin traducir',
    },
  },
  fr: {
    translate: 'Traduire',
    translating: 'Traduction en cours',
    translation: 'Traduction',
    hide: 'Masquer la traduction',
    show: 'Afficher la traduction',
    showOriginal: "Afficher l'original",
    copy: 'Copier',
    copied: 'Traduction copiée',
    retry: 'Réessayer',
    failed: 'Échec de la traduction : {reason}',
    reasons: {
      'api-error': "erreur de l'API",
      'empty-reply': 'réponse vide',
      aborted: 'délai dépassé ou annulé',
      untranslated: 'la réponse est revenue non traduite',
    },
  },
  de: {
    translate: 'Übersetzen',
    translating: 'Wird übersetzt',
    translation: 'Übersetzung',
    hide: 'Übersetzung ausblenden',
    show: 'Übersetzung anzeigen',
    showOriginal: 'Original anzeigen',
    copy: 'Kopieren',
    copied: 'Übersetzung kopiert',
    retry: 'Erneut versuchen',
    failed: 'Übersetzung fehlgeschlagen: {reason}',
    reasons: {
      'api-error': 'API-Fehler',
      'empty-reply': 'leere Antwort',
      aborted: 'Zeitüberschreitung oder abgebrochen',
      untranslated: 'Antwort kam unübersetzt zurück',
    },
  },
}

// ---- Languages: tags, names, and which language a reply is in.

const NAME_HINTS: [RegExp, string][] = [
  [/traditional|繁/i, 'zh-Hant'],
  [/chinese|mandarin|中文|汉语|漢語|简体/i, 'zh-Hans'],
  [/japanese|日本/i, 'ja'],
  [/korean|한국/i, 'ko'],
  [/english|英语|英文|英語/i, 'en'],
  [/spanish|español/i, 'es'],
  [/french|français/i, 'fr'],
  [/german|deutsch/i, 'de'],
]

// zh-CN, zh-SG and plain zh read as Simplified Chinese; zh-TW, zh-HK and
// zh-MO as Traditional, so a name for each can be drawn and asked for.
function normalizeChinese(tag: string): string {
  const lower = tag.toLowerCase()
  if (lower !== 'zh' && !lower.startsWith('zh-')) {
    return tag
  }

  return /hant|-tw|-hk|-mo/.test(lower) ? 'zh-Hant' : 'zh-Hans'
}

// A language tag for a setting written as a tag (`zh-CN`) or a name
// (`chinese`, `Simplified Chinese`); undefined when it is neither.
function toTag(value: string): string | undefined {
  const text = value.trim()
  if (text === '') {
    return undefined
  }
  for (const [pattern, tag] of NAME_HINTS) {
    if (pattern.test(text)) {
      return tag
    }
  }
  try {
    const [tag] = Intl.getCanonicalLocales(text)

    return tag === undefined ? undefined : normalizeChinese(tag)
  } catch {
    return undefined
  }
}

const displayNames = new Map<string, Intl.DisplayNames>()

function nameOf(tag: string, inLanguage: string): string {
  try {
    let names = displayNames.get(inLanguage)
    if (names === undefined) {
      names = new Intl.DisplayNames([inLanguage], { type: 'language' })
      displayNames.set(inLanguage, names)
    }

    return names.of(tag) ?? tag
  } catch {
    return tag
  }
}

function parseTargets(value: unknown): Target[] {
  const seen = new Set<string>()
  const targets: Target[] = []
  for (const entry of String(value ?? '').split(',')) {
    const name = entry.trim()
    if (name === '') {
      continue
    }
    const tag = toTag(name)
    const key = tag ?? name
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    targets.push({
      key,
      family: tag?.split('-')[0]?.toLowerCase(),
      promptName: tag === undefined ? name : nameOf(tag, 'en'),
    })
  }

  return targets.length > 0 ? targets : parseTargets(FALLBACK_TARGETS)
}

// The targets in order: the main language first, so it is the main button
// wherever the reply is in another language; `auto` is the language the
// buttons are drawn in, then English.
function targetsFor(settings: Settings, ui: string): Target[] {
  const targets = settings.targets === 'auto' ? parseTargets(`${ui}, en`) : settings.targets
  const primary = settings.primary

  return primary === undefined ? targets : [primary, ...targets.filter(target => target.key !== primary.key)]
}

// The key of the strings table closest to a tag; English when none is.
function uiLanguageOf(tag: string | undefined): string {
  if (tag === undefined) {
    return 'en'
  }
  const normalized = normalizeChinese(tag)
  if (STRINGS[normalized] !== undefined) {
    return normalized
  }
  const base = normalized.split('-')[0]?.toLowerCase() ?? ''

  return STRINGS[base] !== undefined ? base : 'en'
}

function systemLocale(): string | undefined {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}

// Words that mark a Latin-script reply as English.
const ENGLISH_WORDS = new Set([
  'the', 'and', 'is', 'are', 'to', 'of', 'it', 'that', 'this', 'for', 'with',
  'you', 'on', 'be', 'was', 'have', 'will', 'can', 'if', 'an', 'not',
])

// The base language a reply is written in, judged on its prose (code, inline
// code and links left out): zh, ja, ko or en; undefined when unclear. A Han
// character counts as much as a Latin word, so a Chinese reply full of
// English terms is still Chinese.
function replyLanguage(text: string): string | undefined {
  const prose = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
  const han = (prose.match(/\p{Script=Han}/gu) ?? []).length
  const kana = (prose.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length
  const hangul = (prose.match(/\p{Script=Hangul}/gu) ?? []).length
  const words = prose.match(/\p{Script=Latin}+/gu) ?? []
  const cjk = han + kana
  if (cjk + hangul + words.length < 3) {
    return undefined
  }
  if (cjk >= words.length && cjk >= hangul) {
    return kana > 0 && kana >= cjk * 0.1 ? 'ja' : 'zh'
  }
  if (hangul >= words.length) {
    return 'ko'
  }
  const english = words.filter(word => ENGLISH_WORDS.has(word.toLowerCase())).length

  return english >= Math.max(1, words.length * 0.08) ? 'en' : undefined
}

// The targets offered for a reply: those not in the reply's own language,
// in the configured order, so the first is the main button.
function offeredTargets(targets: Target[], text: string): Target[] {
  const own = replyLanguage(text)
  const others = targets.filter(target => own === undefined || target.family !== own)

  return others.length > 0 ? others : targets
}

// The base language of a target or a kept translation's key: `zh` for
// `zh-Hans`; a name that is no tag, lowercased.
function familyOf(key: string): string {
  return (key.split('-')[0] ?? key).toLowerCase()
}

// `source` names the reply's own language when it is recognised, so the
// model does not take Japanese written in kanji for Chinese. `isRetry` is the
// second ask, after a first answer came back in the reply's own language.
function systemPrompt(language: string, source: string | undefined, isRetry: boolean): string {
  return [
    'You translate the replies an AI coding assistant wrote in a coding session.',
    `Translate the text inside <reply> into ${language}.`,
    ...(source === undefined ? [] : [`The reply is written in ${source}: translate every sentence of it.`]),
    `Only quoted words or phrases already in ${language} stay as they are.`,
    ...(isRetry ? [`An earlier answer handed the reply back untranslated. Write the translation in ${language}.`] : []),
    'Keep the Markdown structure. Leave code blocks, inline code, commands, file paths, URLs and identifiers unchanged.',
    `Write the whole translation inside ${TRANSLATION_OPEN}${TRANSLATION_CLOSE} tags.`,
    'Write nothing outside those tags: no remarks about the text, no notes on how you translated it.',
  ].join('\n')
}

// The keys of the translations that are still in the reply's own language:
// the model sometimes hands a reply back unchanged. Only a language both are
// recognised in counts, and a target in the reply's own language never does.
function untranslatedKeys(source: string, texts: Record<string, string>): string[] {
  const own = replyLanguage(source)
  if (own === undefined) {
    return []
  }

  return Object.entries(texts)
    .filter(([key, text]) => familyOf(key) !== own && replyLanguage(text) === own)
    .map(([key]) => key)
}

const TRANSLATION_OPEN = '<translation>'
const TRANSLATION_CLOSE = '</translation>'

// The model sometimes echoes the <reply> wrapper around its translation.
function cleanTranslation(text: string): string {
  return text
    .trim()
    .replace(/^<reply>\s*/i, '')
    .replace(/\s*<\/reply>$/i, '')
    .trim()
}

// The translation is what the model wrote inside <translation>: a remark it
// makes before or after the tags is dropped. A reply cut off before the
// closing tag keeps what came after the opening one; one with no tags at all
// is taken whole, as before the tags were asked for.
function extractTranslation(raw: string): string {
  const text = raw.trim()
  const open = text.indexOf(TRANSLATION_OPEN)
  if (open === -1) {
    return cleanTranslation(text)
  }
  const start = open + TRANSLATION_OPEN.length
  const close = text.lastIndexOf(TRANSLATION_CLOSE)

  return cleanTranslation(close > start ? text.slice(start, close) : text.slice(start))
}

// ---- Final replies.

function normalize(text: string): string {
  return text
    .replace(/<context>[\s\S]*?<\/context>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function fingerprint(text: string): string {
  const s = normalize(text)
  let a = 0x811c9dc5
  let b = 5381
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = (Math.imul(b, 33) + c) | 0
  }

  return `${s.length}-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`
}

// A model response that calls no tool ends its turn, so its text blocks are the
// final reply; text in a response that also calls a tool is work in progress.
// Answers each final reply as the list of its non-empty text blocks.
async function finalReplies($: EngineInterface): Promise<string[][]> {
  const messages = await $.session.messages({ as: 'api' })
  if (!Array.isArray(messages)) {
    return []
  }

  const found: string[][] = []
  let pending: string[] = []
  let callsTool = false
  const flush = () => {
    const blocks = pending.filter(text => normalize(text) !== '')
    if (!callsTool && blocks.length > 0) {
      found.push(blocks)
    }
    pending = []
    callsTool = false
  }

  for (const message of messages) {
    if (message.role === 'user') {
      flush()
      continue
    }
    for (const block of message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        pending.push(block.text)
      } else if (block.type === 'tool_use') {
        callsTool = true
      }
    }
  }
  flush()

  return found
}

// A final reply as the buttons and the translation see it: one id and one
// text for all of its blocks.
type FinalReply = { id: string; text: string }

// The blocks of a reply are joined with this to make the text translated.
const BLOCK_JOIN = '\n\n'

// Records the final replies not yet known and answers them. A reply of one
// block keeps that block's fingerprint as its id; a reply of several gets the
// fingerprint of its joined text, and each of its blocks a `groups` entry, so
// only the last block draws the buttons, for the whole reply.
async function refresh($: EngineInterface, answer?: string): Promise<FinalReply[]> {
  const found = await finalReplies($)
  const known = new Set(await read($, finals))
  const fresh: FinalReply[] = []
  const freshBlocks: string[] = []
  const freshGroups: Record<string, Group> = {}
  for (const blocks of found) {
    const blockIds = blocks.map(fingerprint)
    if (blockIds.every(blockId => known.has(blockId) || freshBlocks.includes(blockId))) {
      continue
    }
    const text = blocks.join(BLOCK_JOIN)
    const id = blocks.length === 1 ? (blockIds[0] ?? fingerprint(text)) : fingerprint(text)
    blockIds.forEach((blockId, i) => {
      if (!known.has(blockId) && !freshBlocks.includes(blockId)) {
        freshBlocks.push(blockId)
      }
      if (blocks.length > 1) {
        freshGroups[blockId] = i === blocks.length - 1 ? { reply: id, isLast: true, text } : { reply: id, isLast: false }
      }
    })
    fresh.push({ id, text })
  }
  // The turn's answer stands in only when the transcript held no new reply.
  if (fresh.length === 0 && answer !== undefined && normalize(answer) !== '') {
    const id = fingerprint(answer)
    if (!known.has(id)) {
      freshBlocks.push(id)
      fresh.push({ id, text: answer })
    }
  }
  if (freshBlocks.length === 0) {
    return []
  }
  await update($, finals, list => [...list, ...freshBlocks.filter(blockId => !list.includes(blockId))].slice(-MAX_FINALS))
  if (Object.keys(freshGroups).length > 0) {
    const kept = new Set(await read($, finals))
    await update($, groups, map => {
      const next: Record<string, Group> = {}
      for (const [blockId, group] of Object.entries(map)) {
        if (kept.has(blockId)) {
          next[blockId] = group
        }
      }

      return { ...next, ...freshGroups }
    })
  }

  return fresh
}

// The buttons follow the plugin's uiLanguage, else Claude Code's `language`
// setting, else the system's language.
async function refreshUiLanguage($: EngineInterface, configured: string) {
  let tag = configured.toLowerCase() === 'auto' ? undefined : toTag(configured)
  if (tag === undefined) {
    try {
      const setting = await $.settings.read({ key: 'language' })
      tag = typeof setting === 'string' ? toTag(setting) : undefined
    } catch {
      tag = undefined
    }
  }
  const next = uiLanguageOf(tag ?? systemLocale())
  if ((await read($, uiLocale)) !== next) {
    await update($, uiLocale, () => next)
  }
}

// ---- Translations, in the session's state and in $.store between sessions.

function storeKey(id: string): string {
  return `t:${id}`
}

function byteSize(json: string): number {
  return json.length + (json.match(/[^\x00-\x7f]/g)?.length ?? 0) * 2
}

async function loadStored($: EngineInterface, id: string): Promise<StoredReply | undefined> {
  try {
    const value = await $.store.get(storeKey(id))
    if (typeof value === 'object' && value !== null && 'texts' in value) {
      return value as StoredReply
    }
  } catch {
    // Nothing kept, or the store cannot be read: the reply starts afresh.
  }

  return undefined
}

async function saveStored($: EngineInterface, id: string, reply: Reply) {
  if (Object.keys(reply.texts).length === 0) {
    return
  }
  const record: StoredReply = { texts: reply.texts, isHidden: reply.isHidden }
  if (reply.status === 'done' && reply.language !== undefined) {
    record.language = reply.language
  }
  try {
    await $.store.set(storeKey(id), record)
    const raw = await $.store.get(STORE_INDEX)
    const index = (Array.isArray(raw) ? raw : []).filter(
      (entry): entry is [string, number] =>
        Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number',
    )
    const kept = index.filter(([key]) => key !== id)
    kept.push([id, byteSize(JSON.stringify(record))])
    let total = kept.reduce((sum, [, size]) => sum + size, 0)
    while (total > STORE_BUDGET && kept.length > 1) {
      const oldest = kept.shift()
      if (oldest === undefined) {
        break
      }
      total -= oldest[1]
      await $.store.delete(storeKey(oldest[0]))
    }
    await $.store.set(STORE_INDEX, kept)
  } catch {
    // Keeping a translation is a convenience: the session's copy stands.
  }
}

// The reply as the session holds it, else as an earlier session kept it.
// Given the reply's text, translations still in its own language, which an
// earlier version kept unchecked, are left out, and a reply that was showing
// one is offered afresh.
async function currentReply($: EngineInterface, id: string, source?: string): Promise<Reply | undefined> {
  const reply = await savedReply($, id)
  if (reply === undefined || source === undefined) {
    return reply
  }
  const untranslated = untranslatedKeys(source, reply.texts)
  if (untranslated.length === 0) {
    return reply
  }
  const texts = { ...reply.texts }
  for (const key of untranslated) {
    delete texts[key]
  }
  if (reply.status === 'done' && reply.language !== undefined && untranslated.includes(reply.language)) {
    return { isHidden: false, texts }
  }

  return { ...reply, texts }
}

async function savedReply($: EngineInterface, id: string): Promise<Reply | undefined> {
  const live = await read($, { ...replies, id })
  if (live !== undefined) {
    return live
  }
  const stored = await loadStored($, id)
  if (stored === undefined) {
    return undefined
  }
  // A translation made ahead of time and never shown keeps no language.
  if (stored.language === undefined || stored.texts[stored.language] === undefined) {
    return { isHidden: false, texts: stored.texts }
  }

  return { status: 'done', language: stored.language, isHidden: stored.isHidden, texts: stored.texts }
}

async function keep($: EngineInterface, id: string) {
  const saved = await read($, { ...replies, id })
  if (saved !== undefined) {
    await saveStored($, id, saved)
  }
}

// Whether the reply's translation is open: done, not hidden, and there.
function isShowing(reply: Reply | undefined): boolean {
  return (
    reply?.status === 'done' &&
    !reply.isHidden &&
    reply.language !== undefined &&
    reply.texts[reply.language] !== undefined
  )
}

// Whether the reply's open translation takes its place: replaceOriginal is
// on and a translation is open, whatever its language, so the reply shows in
// one language at a time.
function replacesOriginal(settings: Settings, reply: Reply | undefined): boolean {
  return settings.replaceOriginal && isShowing(reply)
}

function withoutPrefetch(reply: Reply): Reply {
  const copy = { ...reply }
  delete copy.prefetching

  return copy
}

async function translate(
  $: EngineInterface,
  model: string,
  id: string,
  text: string,
  target: Target,
) {
  const base = await currentReply($, id, text)
  if (base?.status === 'running') {
    return
  }
  const empty: Reply = { isHidden: false, texts: {} }
  const texts = base?.texts ?? {}

  // Translated before, or ahead of time: show it, no model call.
  if (texts[target.key] !== undefined) {
    await update($, { ...replies, id }, (value): Reply => ({
      ...(value ?? base ?? empty),
      status: 'done',
      language: target.key,
      isHidden: false,
    }))
    await keep($, id)

    return
  }

  const running = (value: Reply | undefined): Reply => ({
    ...(value ?? base ?? empty),
    status: 'running',
    language: target.key,
    isHidden: false,
  })

  // Being translated ahead of time: wait for that one, which shows it.
  if (base?.prefetching === target.key) {
    await update($, { ...replies, id }, running)

    return
  }

  await update($, { ...replies, id }, running)
  const result = await translation($, model, text, target)

  if (result.isAnswered) {
    await update($, { ...replies, id }, (value): Reply => ({
      ...(value ?? base ?? empty),
      status: 'done',
      language: target.key,
      isHidden: false,
      texts: { ...(value?.texts ?? texts), [target.key]: result.text },
    }))
    await keep($, id)
  } else {
    await update($, { ...replies, id }, (value): Reply => ({
      ...(value ?? base ?? empty),
      status: 'error',
      language: target.key,
      isHidden: false,
      error: result.reason,
    }))
  }
}

type Translation = { isAnswered: true; text: string } | { isAnswered: false; reason: string }

// One translation, checked: an empty answer is an error, and one still in
// the reply's own language is asked for once more, then given up as
// untranslated.
async function translation($: EngineInterface, model: string, text: string, target: Target): Promise<Translation> {
  const own = replyLanguage(text)
  const source = own === undefined || own === familyOf(target.key) ? undefined : nameOf(own, 'en')
  for (const isRetry of [false, true]) {
    const result = await $.model.complete({
      model,
      system: systemPrompt(target.promptName, source, isRetry),
      prompt: `<reply>\n${text}\n</reply>`,
      maxTokens: Math.min(32000, Math.max(2048, Math.ceil(text.length * 1.5))),
      timeoutMs: 180_000,
    })
    if (!result.isAnswered) {
      return { isAnswered: false, reason: result.reason }
    }
    const translated = extractTranslation(result.text)
    if (translated === '') {
      return { isAnswered: false, reason: 'empty-reply' }
    }
    if (untranslatedKeys(text, { [target.key]: translated }).length === 0) {
      return { isAnswered: true, text: translated }
    }
  }

  return { isAnswered: false, reason: 'untranslated' }
}

// Translates a reply into the person's main language before anyone asks, and
// keeps it hidden: pressing the button then shows it at once. A press made
// while it runs waits for it and shows it when it lands.
async function prefetch($: EngineInterface, model: string, id: string, text: string, target: Target) {
  const base = await currentReply($, id, text)
  if (base?.texts[target.key] !== undefined || base?.prefetching !== undefined || base?.status === 'running') {
    return
  }
  const empty: Reply = { isHidden: false, texts: {} }
  await update($, { ...replies, id }, (value): Reply => ({ ...(value ?? base ?? empty), prefetching: target.key }))

  const result = await translation($, model, text, target)

  await update($, { ...replies, id }, (value): Reply => {
    const reply = withoutPrefetch(value ?? base ?? empty)
    const isWaiting = reply.status === 'running' && reply.language === target.key
    if (!result.isAnswered) {
      return isWaiting ? { ...reply, status: 'error', error: result.reason } : reply
    }
    const texts = { ...reply.texts, [target.key]: result.text }

    return isWaiting ? { ...reply, status: 'done', isHidden: false, texts } : { ...reply, texts }
  })
  await keep($, id)
}

// Whether a fresh final reply is worth translating ahead of time.
function needsPrefetch(text: string, primary: Target): boolean {
  return normalize(text).length >= PREFETCH_MIN_CHARS && replyLanguage(text) !== primary.family
}

async function setHidden($: EngineInterface, id: string, isHidden: boolean) {
  const base = await currentReply($, id)
  if (base === undefined) {
    return
  }
  await update($, { ...replies, id }, (value): Reply => ({ ...(value ?? base), isHidden }))
  await keep($, id)
}

async function copyText($: EngineInterface, text: string, surface: Surface, message: string) {
  const result = await $.ui.copy({ text, surface })
  if (result.isCopied) {
    $.ui.toast(message)
  }
}

export const register: Register = (on, options) => {
  const primaryName = String(options.primaryLanguage ?? DEFAULT_PRIMARY).trim()
  const primary = primaryName === '' ? undefined : parseTargets(primaryName)[0]
  const languages = String(options.languages ?? 'auto').trim()
  const settings: Settings = {
    model: String(options.model ?? 'haiku'),
    targets: languages === '' || languages.toLowerCase() === 'auto' ? 'auto' : parseTargets(languages),
    primary,
    autoExpand: options.autoExpand === true || String(options.autoExpand).toLowerCase() === 'true',
    replaceOriginal: options.replaceOriginal === true || String(options.replaceOriginal).toLowerCase() === 'true',
    skipPrimaryReplies:
      options.skipPrimaryReplies === true || String(options.skipPrimaryReplies).toLowerCase() === 'true',
    uiLanguage: String(options.uiLanguage ?? 'auto'),
    // Buttons always show unless alwaysShowButtons is turned off.
    showOnHover: options.alwaysShowButtons === false || String(options.alwaysShowButtons).toLowerCase() === 'false',
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refreshUiLanguage($, settings.uiLanguage)
    await refresh($)
    for (const ms of RESCAN_MS) {
      $.clock.after(ms, () => {
        refresh($).catch(() => undefined)
      })
    }

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const fresh = await refresh($, e.answer)
      await refreshUiLanguage($, settings.uiLanguage)
      const primary = settings.primary
      if (primary !== undefined && e.reason === 'answer') {
        // One call per new reply, all of its blocks together. The calls run
        // on a timer, so the turn's end waits for none of them. With
        // autoExpand or replaceOriginal the translation is the one a press
        // makes, so it shows its progress and opens by itself, under the
        // reply or in its place.
        for (const { id, text } of fresh) {
          if (needsPrefetch(text, primary)) {
            $.clock.after(1, () => {
              const work = settings.autoExpand || settings.replaceOriginal
                ? translate($, settings.model, id, text, primary)
                : prefetch($, settings.model, id, text, primary)
              work.catch(() => undefined)
            })
          }
        }
      }
    }

    return done
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) {
      return next(e)
    }

    const blockText = e.props.text
    const blockId = fingerprint(blockText)
    const known = await read($, finals)
    if (!known.includes(blockId)) {
      return next(e)
    }

    // A reply of several blocks draws one set of buttons, under its last
    // block. Its blocks share a hover group, so the pointer on any of them
    // shows the buttons.
    const group = (await read($, groups))[blockId]
    const scope = group === undefined ? undefined : `rt-${group.reply}`
    if (group !== undefined && !group.isLast) {
      const blockOriginal = await next(e)
      const { Box } = $.ui.resolve(e)
      // With the translation in place of the reply, the earlier blocks give
      // way too: the last block draws the whole reply's translation.
      // The block's own text stands in for the reply's in the check of the
      // translation.
      if (replacesOriginal(settings, await currentReply($, group.reply, blockText))) {
        return <Box flexDirection="column" hover={{ scope }} />
      }

      return (
        <Box flexDirection="column" hover={{ scope }}>
          {blockOriginal}
        </Box>
      )
    }
    const id = group?.reply ?? blockId
    const text = group?.text ?? blockText

    const reply = await currentReply($, id, text)
    // A reply in the main language needs no translation: leave it as the
    // engine draws it, unless a translation of it was asked for already.
    const primary = settings.primary
    if (
      settings.skipPrimaryReplies &&
      primary !== undefined &&
      reply?.status === undefined &&
      replyLanguage(text) === primary.family
    ) {
      return next(e)
    }
    const ui = (await read($, uiLocale)) ?? uiLanguageOf(systemLocale())
    const s = STRINGS[ui] ?? EN
    // With replaceOriginal an open translation is drawn where the reply was,
    // and by the engine itself, as it draws the reply: the same type, spacing
    // and width. Only the drawing changes; the stored message stays as it is.
    const replacement =
      replacesOriginal(settings, reply) && reply?.language !== undefined ? reply.texts[reply.language] : undefined
    const drawn = await next(replacement === undefined ? e : { ...e, props: { ...e.props, text: replacement } })
    const { Box, Button, Markdown, Progress, Text } = $.ui.resolve(e)

    const targets = targetsFor(settings, ui)
    const offered = offeredTargets(targets, text)
    const targetOf = (key: string | undefined): Target | undefined =>
      targets.find(target => target.key === key) ??
      (key === undefined ? undefined : { key, promptName: key })
    const label = (target: Target) => (target.family === undefined ? target.key : nameOf(target.key, ui))
    const current = targetOf(reply?.language)
    const toButton = (target: Target, isMain: boolean) => (
      <Button
        key={`to-${target.key}-${id}`}
        label={isMain ? `${s.translate} · ${label(target)}` : label(target)}
        dimColor={!isMain}
        onPress={() => translate($, settings.model, id, text, target)}
      />
    )
    const others = offered.filter(target => target.key !== current?.key).map(target => toButton(target, false))

    let panel
    let toolbar
    // While a translation is open its buttons stay, hover or not.
    let isOpen = false
    // With replaceOriginal, an open translation is drawn where the reply was.
    const isReplaced = replacement !== undefined
    if (reply === undefined || reply.status === undefined || current === undefined) {
      toolbar = offered.map((target, i) => toButton(target, i === 0))
    } else if (reply.status === 'running') {
      panel = <Progress label={`${s.translating} · ${label(current)}`} />
    } else if (reply.status === 'error') {
      const reason = s.reasons[reply.error ?? ''] ?? reply.error ?? ''
      panel = (
        <Box flexDirection="row" gap="sm">
          <Text color="error">{s.failed.replace('{reason}', reason)}</Text>
          <Button
            key={`retry-${id}`}
            label={s.retry}
            dimColor
            onPress={() => translate($, settings.model, id, text, current)}
          />
        </Box>
      )
      toolbar = others
    } else if (reply.isHidden || reply.texts[current.key] === undefined) {
      toolbar = [
        <Button key={`show-${id}`} label={s.show} onPress={() => setHidden($, id, false)} />,
        ...others,
      ]
    } else {
      const translated = reply.texts[current.key] ?? ''
      isOpen = true
      const heading = <Text dimColor>{`${s.translation} · ${label(current)}`}</Text>
      // In the reply's place the engine draws the translation (`drawn`), so
      // the panel is its heading alone.
      panel = isReplaced ? (
        heading
      ) : (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          {heading}
          <Markdown text={translated} />
        </Box>
      )
      toolbar = [
        <Button
          key={`hide-${id}`}
          label={isReplaced ? s.showOriginal : s.hide}
          dimColor
          onPress={() => setHidden($, id, true)}
        />,
        <Button
          key={`copy-${id}`}
          label={s.copy}
          dimColor
          onPress={press => copyText($, translated, press.surface, s.copied)}
        />,
        ...others,
      ]
    }

    // On the desktop the buttons show while the pointer is over the reply, in
    // a strip of fixed height they float in (`position: absolute`), so
    // showing them reflows nothing; a translation, its progress and an error
    // always show.
    const onHover = settings.showOnHover && e.surface === 'desktop' && !isOpen
    const hasButtons = toolbar !== undefined && toolbar.length > 0
    const bar = onHover ? (
      <Box height={HOVER_STRIP_ROWS} marginTop="sm">
        {hasButtons ? (
          <Box
            position="absolute"
            top={0}
            left={0}
            display="none"
            hover={scope === undefined ? { display: 'flex' } : { display: 'flex', scope }}
            flexDirection="row"
            gap="sm"
          >
            {toolbar}
          </Box>
        ) : undefined}
      </Box>
    ) : hasButtons ? (
      <Box flexDirection="row" gap="sm" marginTop="sm">
        {toolbar}
      </Box>
    ) : undefined

    return (
      <Box key={`reply-${id}`} flexDirection="column" hover={scope === undefined ? undefined : { scope }}>
        {isReplaced ? panel : undefined}
        {drawn}
        {isReplaced || panel === undefined ? undefined : <Box marginTop="sm">{panel}</Box>}
        {bar}
      </Box>
    )
  })
}
