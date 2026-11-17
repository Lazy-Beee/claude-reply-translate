import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Group, Note, Reply, Turns } from '../types'

// How many blocks with buttons the session remembers. With translateAll a
// long session has a block for every note Claude wrote between tool calls.
const MAX_FINALS = 5000

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

// The fingerprints of the blocks that get buttons: the final replies' blocks,
// and with translateAll every other text block of Claude's too.
const finals = atom({ plugin: 'reply-translate', key: 'finals' } as const, [], {
  shape: 'finals-1',
})

// The blocks of the final replies made of several: which reply each belongs
// to and whether it is the last, which draws the buttons and holds the text.
const groups = atom({ plugin: 'reply-translate', key: 'groups' } as const, {}, {
  shape: 'groups-1',
})

// Under translateAll, how each turn's notes hang on its final reply.
const turns = atom(
  { plugin: 'reply-translate', key: 'turns' } as const,
  { noteOf: {}, notesOf: {}, languageOf: {} },
  { shape: 'turns-2' },
)

// The tokens the session's translations have taken so far, kept in $.store
// too, under SPENT_PREFIX and the session's id, so a reopened session goes on
// from its total. The totals of the latest MAX_SPENT_SESSIONS sessions are
// kept.
const spent = atom({ plugin: 'reply-translate', key: 'spent' } as const, { session: '', tokens: 0 }, {
  shape: 'spent-1',
})
const SPENT_PREFIX = 'u:'
const MAX_SPENT_SESSIONS = 100

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
  // How many of the latest final replies the band above the prompt acts on;
  // 0 draws no band.
  controlRange: number
  // Every text block of Claude's gets buttons, not only the final replies.
  translateAll: boolean
  // Each translation says how many tokens it took, and the band the
  // session's total.
  showTokens: boolean
  // The mark of a translation in a unit's place goes on a small line of its
  // own under it, rather than at the end of its last line: the reply's text
  // has no type size, and the desktop draws no HTML in it.
  isMarkBelow: boolean
}

const DEFAULT_CONTROL_RANGE = 10

// Translations the band starts at once; the rest wait their turn.
const CONTROL_PARALLEL = 4

// The button that makes a turn's translation again: after a failure, or
// over one that came out wrong. A glyph, as a browser's reload is.
const REFRESH = '\u21BB'

// How far in the mark's own line starts on the desktop, to line up with the
// reply's text: the desktop draws that text a little in from the edge of the
// tree a hook returns (about 5px, measured on a screenshot at 150 %), and
// `xs` is its smallest padding step, 4 to 6px.
const MARK_LINE_INSET = 'xs'

// The label of the button marked as a turn's mode: a check before its name.
// The desktop draws its own native buttons: of a Button's look it takes the
// primary variant (which stood out too much) and the dim label, and drew
// neither a bold label nor a tint behind it, so the mark is in the text.
const markedLabel = (name: string) => `✓ ${name}`

// Replies shorter than this, normalized, are not translated ahead of time.
const PREFETCH_MIN_CHARS = 12

type StoredReply = {
  texts: Record<string, string>
  language?: string
  isHidden: boolean
  tokens?: Record<string, number>
  spent?: number
}

// ---- Strings of the buttons, in the languages the buttons can be drawn in.

type Strings = {
  translating: string
  translation: string
  // The button that shows a turn as it was written.
  original: string
  // The note that ends a translation drawn in the reply's place, on its last
  // line: what it was translated from, or only that it is one. `{tokens}` is
  // where the tokens it took go, after `separator`, with showTokens.
  translatedFrom: string
  translatedMark: string
  separator: string
  // A count of tokens; on the band, what the recent replies took (`{range}`
  // the band's label) and the session's total.
  tokens: string
  recentTokens: string
  total: string
  // The band above the prompt that acts on the last few replies at once.
  recent: string
  recentOne: string
  failed: string
  reasons: Record<string, string>
}

const EN: Strings = {
  translating: 'Translating',
  translation: 'Translation',
  original: 'Original',
  translatedFrom: '(translated from {language}{tokens})',
  translatedMark: '(translated{tokens})',
  separator: ', ',
  tokens: '{count} tokens',
  recentTokens: '{range}: {tokens}',
  total: 'Session total: {tokens}',
  recent: 'Last {count} replies',
  recentOne: 'Last reply',
  failed: 'Translation failed: {reason}',
  reasons: {
    'api-error': 'API error',
    'empty-reply': 'empty reply',
    aborted: 'timed out or cancelled',
    untranslated: 'the reply came back untranslated',
    incomplete: 'the translation came back incomplete',
  },
}

const STRINGS: Record<string, Strings> = {
  en: EN,
  'zh-Hans': {
    translating: '正在翻译',
    translation: '译文',
    original: '原文',
    translatedFrom: '（翻译自{language}{tokens}）',
    translatedMark: '（译文{tokens}）',
    separator: '，',
    tokens: '{count} tokens',
    recentTokens: '{range}：{tokens}',
    total: '会话总计 {tokens}',
    recent: '最近 {count} 条回复',
    recentOne: '最近 1 条回复',
    failed: '翻译失败：{reason}',
    reasons: {
      'api-error': '接口出错',
      'empty-reply': '返回为空',
      aborted: '超时或已取消',
      untranslated: '返回的仍是原文',
      incomplete: '译文不完整',
    },
  },
  'zh-Hant': {
    translating: '正在翻譯',
    translation: '譯文',
    original: '原文',
    translatedFrom: '（翻譯自{language}{tokens}）',
    translatedMark: '（譯文{tokens}）',
    separator: '，',
    tokens: '{count} tokens',
    recentTokens: '{range}：{tokens}',
    total: '會話總計 {tokens}',
    recent: '最近 {count} 則回覆',
    recentOne: '最近 1 則回覆',
    failed: '翻譯失敗：{reason}',
    reasons: {
      'api-error': '介面出錯',
      'empty-reply': '回應為空',
      aborted: '逾時或已取消',
      untranslated: '回傳的仍是原文',
      incomplete: '譯文不完整',
    },
  },
  ja: {
    translating: '翻訳中',
    translation: '訳文',
    original: '原文',
    translatedFrom: '（{language}から翻訳{tokens}）',
    translatedMark: '（翻訳{tokens}）',
    separator: '、',
    tokens: '{count} トークン',
    recentTokens: '{range}：{tokens}',
    total: 'セッション合計 {tokens}',
    recent: '直近 {count} 件の返信',
    recentOne: '直近の返信',
    failed: '翻訳に失敗しました：{reason}',
    reasons: {
      'api-error': 'API エラー',
      'empty-reply': '空の応答',
      aborted: 'タイムアウトまたはキャンセル',
      untranslated: '原文のまま返されました',
      incomplete: '訳文が不完全です',
    },
  },
  ko: {
    translating: '번역 중',
    translation: '번역문',
    original: '원문',
    translatedFrom: '({language}에서 번역{tokens})',
    translatedMark: '(번역문{tokens})',
    separator: ', ',
    tokens: '{count} 토큰',
    recentTokens: '{range}: {tokens}',
    total: '세션 합계 {tokens}',
    recent: '최근 답변 {count}개',
    recentOne: '최근 답변',
    failed: '번역 실패: {reason}',
    reasons: {
      'api-error': 'API 오류',
      'empty-reply': '빈 응답',
      aborted: '시간 초과 또는 취소됨',
      untranslated: '원문 그대로 반환됨',
      incomplete: '번역이 불완전함',
    },
  },
  es: {
    translating: 'Traduciendo',
    translation: 'Traducción',
    original: 'Original',
    translatedFrom: '(traducido del {language}{tokens})',
    translatedMark: '(traducido{tokens})',
    separator: ', ',
    tokens: '{count} tokens',
    recentTokens: '{range}: {tokens}',
    total: 'Total de la sesión: {tokens}',
    recent: 'Últimas {count} respuestas',
    recentOne: 'Última respuesta',
    failed: 'Error al traducir: {reason}',
    reasons: {
      'api-error': 'error de la API',
      'empty-reply': 'respuesta vacía',
      aborted: 'tiempo agotado o cancelado',
      untranslated: 'la respuesta volvió sin traducir',
      incomplete: 'la traducción llegó incompleta',
    },
  },
  fr: {
    translating: 'Traduction en cours',
    translation: 'Traduction',
    original: 'Original',
    translatedFrom: "(traduit de l'original en {language}{tokens})",
    translatedMark: '(traduit{tokens})',
    separator: ', ',
    tokens: '{count} jetons',
    recentTokens: '{range} : {tokens}',
    total: 'Total de la session : {tokens}',
    recent: 'Les {count} dernières réponses',
    recentOne: 'La dernière réponse',
    failed: 'Échec de la traduction : {reason}',
    reasons: {
      'api-error': "erreur de l'API",
      'empty-reply': 'réponse vide',
      aborted: 'délai dépassé ou annulé',
      untranslated: 'la réponse est revenue non traduite',
      incomplete: 'la traduction est revenue incomplète',
    },
  },
  de: {
    translating: 'Wird übersetzt',
    translation: 'Übersetzung',
    original: 'Original',
    translatedFrom: '(übersetzt, Original auf {language}{tokens})',
    translatedMark: '(übersetzt{tokens})',
    separator: ', ',
    tokens: '{count} Tokens',
    recentTokens: '{range}: {tokens}',
    total: 'Sitzung gesamt: {tokens}',
    recent: 'Letzte {count} Antworten',
    recentOne: 'Letzte Antwort',
    failed: 'Übersetzung fehlgeschlagen: {reason}',
    reasons: {
      'api-error': 'API-Fehler',
      'empty-reply': 'leere Antwort',
      aborted: 'Zeitüberschreitung oder abgebrochen',
      untranslated: 'Antwort kam unübersetzt zurück',
      incomplete: 'Übersetzung kam unvollständig zurück',
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

// What was wrong with a first answer, which the second ask names: it came
// back in the reply's own language, or far shorter than the reply.
type Retry = 'untranslated' | 'incomplete'

// `source` names the reply's own language when it is recognised, so the
// model does not take Japanese written in kanji for Chinese. `retry` is set
// on the second ask, after a first answer that was no translation.
function systemPrompt(language: string, source: string | undefined, retry: Retry | undefined): string {
  return [
    'You translate the replies an AI coding assistant wrote in a coding session.',
    `Translate the text inside <reply> into ${language}.`,
    ...(source === undefined ? [] : [`The reply is written in ${source}: translate every sentence of it.`]),
    `Only quoted words or phrases already in ${language} stay as they are.`,
    ...(retry === 'untranslated'
      ? [`An earlier answer handed the reply back untranslated. Write the translation in ${language}.`]
      : []),
    ...(retry === 'incomplete'
      ? [
          'An earlier answer was no full translation: it described the task, or left most of the reply out. Translate the whole reply, from its first sentence to its last.',
        ]
      : []),
    'Keep the Markdown structure. Leave code blocks, inline code, commands, file paths, URLs and identifiers unchanged.',
    `Start your answer with ${TRANSLATION_OPEN} and write the whole translation inside ${TRANSLATION_OPEN}${TRANSLATION_CLOSE} tags.`,
    'Write nothing outside those tags: no remarks about the text, no plan, no notes on how you translated it.',
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

// A translation far shorter than its reply is none: seen in use, Haiku
// answered a 2,000-character note with a remark on how it would translate it.
// Prose takes at least this share of its length in another language (Chinese
// for English runs to about a third); a short reply is not held to it.
const MIN_LENGTH_SHARE = 0.15
const LONG_REPLY = 200

function isTooShort(source: string, translated: string): boolean {
  const length = normalize(source).length

  return length >= LONG_REPLY && normalize(translated).length < length * MIN_LENGTH_SHARE
}

// The keys of the translations of no use: still in the reply's own language,
// or far too short to be all of it.
function unusableKeys(source: string, texts: Record<string, string>): string[] {
  const untranslated = untranslatedKeys(source, texts)

  return Object.entries(texts)
    .filter(([key, text]) => untranslated.includes(key) || isTooShort(source, text))
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
// Thinking is never a unit, not even the notes a model writes as thinking
// that the desktop shows as text: the desktop draws those itself, outside
// the components a mod draws, so a translation could not take their place.

// A run of Claude's text the buttons stand under: a final reply (the text of
// a response that calls no tool, all its blocks together), or with
// translateAll one text block of a response that calls a tool. `turn`
// counts the person's prompts before it.
type Unit = { blocks: string[]; turn: number; isFinal: boolean }

// Answers the units in the transcript, in order, and the number of the
// latest turn. A user message that holds no tool result is a prompt and
// opens a turn.
async function transcriptUnits($: EngineInterface, all: boolean): Promise<{ units: Unit[]; lastTurn: number }> {
  const messages = await $.session.messages({ as: 'api' })
  if (!Array.isArray(messages)) {
    return { units: [], lastTurn: 0 }
  }

  const units: Unit[] = []
  let turn = 0
  let pending: string[] = []
  let callsTool = false
  const flush = () => {
    const blocks = pending.filter(text => normalize(text) !== '')
    if (!callsTool && blocks.length > 0) {
      units.push({ blocks, turn, isFinal: true })
    } else if (all) {
      for (const block of blocks) {
        units.push({ blocks: [block], turn, isFinal: false })
      }
    }
    pending = []
    callsTool = false
  }

  for (const message of messages) {
    if (message.role === 'user') {
      flush()
      const content: unknown = message.content
      const isToolResult =
        Array.isArray(content) &&
        content.some(block => typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_result')
      if (!isToolResult) {
        turn += 1
      }
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

  return { units, lastTurn: turn }
}

// A unit as the buttons and the translation see it: one id and one text for
// all of its blocks.
type FinalReply = { id: string; text: string }

// The blocks of a reply are joined with this to make the text translated.
const BLOCK_JOIN = '\n\n'

// A final reply from its blocks: one block keeps that block's fingerprint as
// its id; several get the fingerprint of their joined text.
function replyOf(blocks: string[]): FinalReply {
  const text = blocks.join(BLOCK_JOIN)
  const first = blocks[0]
  const id = blocks.length === 1 && first !== undefined ? fingerprint(first) : fingerprint(text)

  return { id, text }
}

// The units of one turn: its final replies and its notes, in order. The last
// final reply is the turn's: its buttons act on the notes too.
type TurnUnits = { finals: FinalReply[]; notes: FinalReply[] }

function turnsOf(units: Unit[]): TurnUnits[] {
  const byTurn = new Map<number, TurnUnits>()
  for (const unit of units) {
    let entry = byTurn.get(unit.turn)
    if (entry === undefined) {
      entry = { finals: [], notes: [] }
      byTurn.set(unit.turn, entry)
    }
    ;(unit.isFinal ? entry.finals : entry.notes).push(replyOf(unit.blocks))
  }

  return [...byTurn.values()]
}

// How the notes hang on the final replies, as `turns` keeps it.
function turnMapOf(units: Unit[]): Turns {
  const map: Turns = { noteOf: {}, notesOf: {}, languageOf: {} }
  for (const turn of turnsOf(units)) {
    for (const final of turn.finals) {
      const language = replyLanguage(final.text)
      if (language !== undefined) {
        map.languageOf[final.id] = language
      }
    }
    if (turn.notes.length === 0) {
      continue
    }
    const final = turn.finals[turn.finals.length - 1]
    for (const note of turn.notes) {
      map.noteOf[note.id] = final?.id ?? ''
    }
    if (final !== undefined) {
      map.notesOf[final.id] = turn.notes.map((note): Note => {
        const language = replyLanguage(note.text)

        return language === undefined ? { id: note.id } : { id: note.id, language }
      })
    }
  }

  return map
}

// Records the final replies not yet known and answers them. A reply of one
// block keeps that block's fingerprint as its id; a reply of several gets the
// fingerprint of its joined text, and each of its blocks a `groups` entry, so
// only the last block draws the buttons, for the whole reply.
// Under translateAll every unit is recorded, and `turns` with them. Answers
// every unit of the latest turn.
async function refresh($: EngineInterface, all: boolean, answer?: string): Promise<FinalReply[]> {
  const { units, lastTurn } = await transcriptUnits($, all)
  const turnMap = turnMapOf(units)
  if (JSON.stringify(turnMap) !== JSON.stringify(await read($, turns))) {
    await update($, turns, (): Turns => turnMap)
  }
  const latest = units.filter(unit => unit.turn === lastTurn).map(unit => replyOf(unit.blocks))
  const known = new Set(await read($, finals))
  const fresh: FinalReply[] = []
  const freshBlocks: string[] = []
  const freshGroups: Record<string, Group> = {}
  for (const { blocks } of units) {
    const blockIds = blocks.map(fingerprint)
    if (blockIds.every(blockId => known.has(blockId) || freshBlocks.includes(blockId))) {
      continue
    }
    const { id, text } = replyOf(blocks)
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
      if (latest.length === 0) {
        latest.push({ id, text: answer })
      }
    }
  }
  if (freshBlocks.length === 0) {
    return latest
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

  return latest
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
  const tokens = Object.entries(reply.tokens ?? {}).filter(([key]) => reply.texts[key] !== undefined)
  if (tokens.length > 0) {
    record.tokens = Object.fromEntries(tokens)
  }
  if (reply.spent !== undefined && reply.spent > 0) {
    record.spent = reply.spent
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
// Given the reply's text, translations of no use (still in its own language,
// or far too short), which an earlier version kept unchecked, are left out,
// and a reply that was showing one is offered afresh.
async function currentReply($: EngineInterface, id: string, source?: string): Promise<Reply | undefined> {
  const reply = await savedReply($, id)
  if (reply === undefined || source === undefined) {
    return reply
  }
  const unusable = unusableKeys(source, reply.texts)
  if (unusable.length === 0) {
    return reply
  }
  const texts = { ...reply.texts }
  const tokens = { ...reply.tokens }
  for (const key of unusable) {
    delete texts[key]
    delete tokens[key]
  }
  if (reply.status === 'done' && reply.language !== undefined && unusable.includes(reply.language)) {
    return { isHidden: false, texts, tokens, ...(reply.spent === undefined ? {} : { spent: reply.spent }) }
  }

  return { ...reply, texts, tokens }
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
  const counted = {
    ...(typeof stored.tokens === 'object' && stored.tokens !== null ? { tokens: stored.tokens } : {}),
    ...(typeof stored.spent === 'number' && Number.isFinite(stored.spent) ? { spent: stored.spent } : {}),
  }
  // A translation made ahead of time and never shown keeps no language.
  if (stored.language === undefined || stored.texts[stored.language] === undefined) {
    return { isHidden: false, texts: stored.texts, ...counted }
  }

  return { status: 'done', language: stored.language, isHidden: stored.isHidden, texts: stored.texts, ...counted }
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

// What a translation drawn in a unit's place says it was translated from:
// the unit's own language when it is recognised, then the tokens it took when
// they are given.
function markOf(s: Strings, source: string | undefined, ui: string, tokens?: number): string {
  const mark = source === undefined ? s.translatedMark : s.translatedFrom.replace('{language}', nameOf(source, ui))

  return mark.replace('{tokens}', tokens === undefined ? '' : `${s.separator}${countOf(s, tokens, ui)}`)
}

// The mark on a line of its own, under the translation: no brackets, the
// first letter a capital, the tokens after a middle dot.
function lineMarkOf(s: Strings, source: string | undefined, ui: string, tokens?: number): string {
  const inner = markOf(s, source, ui).replace(/^[(（](.*)[)）]$/u, '$1')
  const said = inner.charAt(0).toLocaleUpperCase(ui) + inner.slice(1)

  return tokens === undefined ? said : `${said} · ${countOf(s, tokens, ui)}`
}

// The heading of a translation drawn under its unit: the language it is in,
// then the tokens it took when they are given.
function headingOf(s: Strings, name: string, tokens: number | undefined, ui: string): string {
  return [s.translation, name, ...(tokens === undefined ? [] : [countOf(s, tokens, ui)])].join(' · ')
}

// A translation drawn in a unit's place, its mark at the end of its last
// line, in italics, so it takes no line of its own. After a code block, a
// table, a rule, a heading or a math block it starts a paragraph: on their
// line it would join them.
function withMark(text: string, mark: string): string {
  const body = text.replace(/\s+$/u, '')
  const last = body.slice(body.lastIndexOf('\n') + 1).trim()
  const note = `*${mark}*`
  const endsBlock =
    /^(```|~~~)/u.test(last) ||
    last.startsWith('|') ||
    /^([-*_])(\s*\1){2,}$/u.test(last) ||
    /^#{1,6}\s/u.test(last) ||
    last.endsWith('$$')
  if (body === '' || endsBlock) {
    return body === '' ? note : `${body}\n\n${note}`
  }
  // A full-width bracket needs no space before it; emphasis just ended does,
  // or its markers would run into the mark's.
  const gap = mark.startsWith('（') && !/[*_~]$/u.test(body) ? '' : ' '

  return `${body}${gap}${note}`
}

function withoutPrefetch(reply: Reply): Reply {
  const copy = { ...reply }
  delete copy.prefetching

  return copy
}

// Puts a unit in `target`: a translation kept shows with no call, else the
// model is asked. `isFresh` asks it again whatever was kept, for ↻.
async function translate(
  $: EngineInterface,
  model: string,
  id: string,
  text: string,
  target: Target,
  isFresh = false,
) {
  const base = await currentReply($, id, text)
  if (base?.status === 'running') {
    return
  }
  const empty: Reply = { isHidden: false, texts: {} }
  const texts = base?.texts ?? {}

  // Translated before, or ahead of time: show it, no model call.
  if (!isFresh && texts[target.key] !== undefined) {
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
  if (!isFresh && base?.prefetching === target.key) {
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
      tokens: { ...(value ?? base)?.tokens, [target.key]: result.tokens },
      spent: spentOn(value ?? base, result.tokens),
    }))
    await keep($, id)
  } else {
    await update($, { ...replies, id }, (value): Reply => ({
      ...(value ?? base ?? empty),
      status: 'error',
      language: target.key,
      isHidden: false,
      error: result.reason,
      spent: spentOn(value ?? base, result.tokens),
    }))
  }
}

// A translation or why there is none, and the tokens its calls took.
type Translation = { isAnswered: true; text: string; tokens: number } | { isAnswered: false; reason: string; tokens: number }

// One translation, checked: an empty answer is an error, and one still in
// the reply's own language, or far shorter than the reply, is asked for once
// more, saying what was wrong, then given up as untranslated or incomplete.
async function translation($: EngineInterface, model: string, text: string, target: Target): Promise<Translation> {
  const own = replyLanguage(text)
  const source = own === undefined || own === familyOf(target.key) ? undefined : nameOf(own, 'en')
  let retry: Retry | undefined
  let tokens = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await $.model.complete({
      model,
      system: systemPrompt(target.promptName, source, retry),
      prompt: `<reply>\n${text}\n</reply>`,
      maxTokens: Math.min(32000, Math.max(2048, Math.ceil(text.length * 1.5))),
      timeoutMs: 180_000,
    })
    const used = tokensOf(result.usage)
    tokens += used
    await spend($, used)
    if (!result.isAnswered) {
      return { isAnswered: false, reason: result.reason, tokens }
    }
    const translated = extractTranslation(result.text)
    if (translated === '') {
      return { isAnswered: false, reason: 'empty-reply', tokens }
    }
    if (untranslatedKeys(text, { [target.key]: translated }).length > 0) {
      retry = 'untranslated'
    } else if (isTooShort(text, translated)) {
      retry = 'incomplete'
    } else {
      return { isAnswered: true, text: translated, tokens }
    }
  }

  return { isAnswered: false, reason: retry ?? 'untranslated', tokens }
}

// ---- Tokens: what each translation took, and the session's total.

// A call's tokens, its four counts together: input uncached, read from the
// prompt cache and written to it, and output.
function tokensOf(usage: ModelUsage | undefined): number {
  if (usage === undefined) {
    return 0
  }
  const counts = [
    usage.input_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens,
    usage.output_tokens,
  ]

  return counts.reduce((sum, count) => sum + (Number.isFinite(count) ? count : 0), 0)
}

// A count of tokens as the interface language writes it: `1,234 tokens`.
function countOf(s: Strings, tokens: number, ui: string): string {
  let count: string
  try {
    count = new Intl.NumberFormat(ui).format(tokens)
  } catch {
    count = String(tokens)
  }

  return s.tokens.replace('{count}', count)
}

function spentKey(session: string): string {
  return `${SPENT_PREFIX}${session}`
}

// Each write of the total to $.store waits for the one before, and writes
// the total as it stands then, so the last write holds the latest.
let spentWrites: Promise<unknown> = Promise.resolve()

// Adds a call's tokens to the session's total. Counting never stops a
// translation.
async function spend($: EngineInterface, tokens: number) {
  if (tokens <= 0) {
    return
  }
  try {
    const session = await $.session.id()
    await update($, spent, value => ({ session, tokens: (value.session === session ? value.tokens : 0) + tokens }))
    spentWrites = spentWrites
      .then(async () => {
        const value = await read($, spent)
        if (value.session === session) {
          await $.store.set(spentKey(session), value.tokens)
        }
      })
      .catch(() => undefined)
    await spentWrites
  } catch {
    // The total is a convenience: the translation stands.
  }
}

// Takes up the session's total where an earlier run of it left off, and
// keeps the totals of the latest sessions only.
async function loadSpent($: EngineInterface) {
  try {
    const session = await $.session.id()
    const kept = Number(await $.store.get(spentKey(session)))
    const stored = Number.isFinite(kept) && kept > 0 ? kept : 0
    await update($, spent, value =>
      value.session === session && value.tokens >= stored ? value : { session, tokens: stored },
    )
    const others = (await $.store.keys()).filter(key => key.startsWith(SPENT_PREFIX) && key !== spentKey(session))
    for (const key of others.slice(0, Math.max(0, others.length - (MAX_SPENT_SESSIONS - 1)))) {
      await $.store.delete(key)
    }
  } catch {
    // No total to take up: the session counts from nothing.
  }
}

// The session's total as the band shows it: none after a /clear until the
// new session's first call.
async function sessionTotal($: EngineInterface): Promise<number> {
  const value = await read($, spent)
  try {
    return value.session === (await $.session.id()) ? value.tokens : 0
  } catch {
    return value.tokens
  }
}

// What a unit's translations have taken, with the tokens of one more try.
function spentOn(reply: Reply | undefined, tokens: number): number {
  return (reply?.spent ?? 0) + tokens
}

// What the open translation of a unit took, for its mark or heading: with
// showTokens, and when it was counted.
function shownTokens(settings: Settings, reply: Reply | undefined): number | undefined {
  return settings.showTokens && reply?.language !== undefined ? reply.tokens?.[reply.language] : undefined
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
    const reply = { ...withoutPrefetch(value ?? base ?? empty), spent: spentOn(value ?? base, result.tokens) }
    const isWaiting = reply.status === 'running' && reply.language === target.key
    if (!result.isAnswered) {
      return isWaiting ? { ...reply, status: 'error', error: result.reason } : reply
    }
    const texts = { ...reply.texts, [target.key]: result.text }
    const tokens = { ...reply.tokens, [target.key]: result.tokens }

    return isWaiting ? { ...reply, status: 'done', isHidden: false, texts, tokens } : { ...reply, texts, tokens }
  })
  await keep($, id)
}

// The translations into the main language that the latest turn's units are
// due as they come: one each for those nothing was asked of yet, all of a
// reply's blocks together. With autoExpand or replaceOriginal the
// translation is the one a press makes, so it shows its progress and opens
// by itself, under the unit or in its place; else it is made ahead of time.
async function aheadTasks(
  $: EngineInterface,
  settings: Settings,
  primary: Target,
  latest: FinalReply[],
): Promise<(() => Promise<unknown>)[]> {
  const isShown = settings.autoExpand || settings.replaceOriginal
  const tasks: (() => Promise<unknown>)[] = []
  for (const { id, text } of latest) {
    const reply = await currentReply($, id, text)
    if (needsPrefetch(text, primary) && reply?.status === undefined && reply?.prefetching === undefined) {
      tasks.push(() =>
        isShown ? translate($, settings.model, id, text, primary) : prefetch($, settings.model, id, text, primary),
      )
    }
  }

  return tasks
}

// Records the notes written so far in the turn and translates them.
async function catchUp($: EngineInterface, settings: Settings, primary: Target) {
  const latest = await refresh($, true)
  await runLimited(await aheadTasks($, settings, primary, latest), CONTROL_PARALLEL)
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

// ---- The band above the prompt: the last few final replies at once.

// A whole number of replies, 0 or more; the default for anything else.
function controlRangeOf(value: unknown): number {
  const count = Number(String(value ?? DEFAULT_CONTROL_RANGE).trim())

  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : DEFAULT_CONTROL_RANGE
}

// The targets a turn is offered: those that at least one of its units is not
// written in, in the configured order, so the first is the main button; all
// of them when none is left. A turn of one reply is offered what the reply is.
function turnTargets(targets: Target[], languages: (string | undefined)[]): Target[] {
  const others = targets.filter(target =>
    languages.some(language => language === undefined || target.family !== language),
  )

  return others.length > 0 ? others : targets
}

// The last `count` turns that hold units, oldest first, each as the units the
// band acts on: its notes, then its final replies. Only these are touched,
// so a long conversation costs no more than a short one.
async function recentTurns($: EngineInterface, count: number, all: boolean): Promise<FinalReply[][]> {
  if (count <= 0) {
    return []
  }

  return turnsOf((await transcriptUnits($, all)).units)
    .slice(-count)
    .map(turn => [...turn.notes, ...turn.finals])
}

// The units a final reply's buttons act on: the notes of its turn, then the
// reply. Without translateAll, or for a reply that is not its turn's last,
// the reply alone.
async function turnOfReply($: EngineInterface, all: boolean, id: string, text: string): Promise<FinalReply[]> {
  if (all) {
    for (const turn of turnsOf((await transcriptUnits($, true)).units)) {
      const final = turn.finals[turn.finals.length - 1]
      if (final !== undefined && final.id === id) {
        return [...turn.notes, final]
      }
    }
  }

  return [{ id, text }]
}

// Runs the tasks with at most `limit` of them at a time.
async function runLimited(tasks: (() => Promise<unknown>)[], limit: number) {
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next]
      next += 1
      await task?.().catch(() => undefined)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
}

// What a turn shows when it shows no translation: its parts as written.
const ORIGINAL = ''

// A part of a turn as its buttons see it: the language it is written in, when
// recognised, and its translations.
type Part = { language?: string; reply: Reply | undefined }

// Whether a part reads in `target`: it shows its translation into it, or it
// is written in it and shows none.
function readsIn(part: Part, target: Target): boolean {
  return isShowing(part.reply)
    ? part.reply?.language === target.key
    : target.family !== undefined && part.language === target.family
}

// The mode a turn's buttons mark: ORIGINAL when it shows no translation,
// else the language it shows, the first part's (the reply's) when its parts
// show more than one.
function modeOf(parts: Part[]): string {
  return parts.find(part => isShowing(part.reply))?.reply?.language ?? ORIGINAL
}

// The mode the band marks: the one every recent turn is in. ORIGINAL when
// none shows a translation; a language when each of their parts reads in it;
// none when they differ.
function sharedMode(turnParts: Part[][], targets: Target[]): string | undefined {
  if (turnParts.every(parts => !parts.some(part => isShowing(part.reply)))) {
    return ORIGINAL
  }

  return targets.find(target => turnParts.every(parts => parts.every(part => readsIn(part, target))))?.key
}

// The work of putting units in `target`: a unit written in that language
// shows as it is, the rest are translated, a kept translation costing no
// call. A unit being translated is left to finish.
async function languageTasks(
  $: EngineInterface,
  settings: Settings,
  units: FinalReply[],
  target: Target,
  isFresh = false,
): Promise<(() => Promise<unknown>)[]> {
  const tasks: (() => Promise<unknown>)[] = []
  for (const unit of units) {
    const reply = await currentReply($, unit.id, unit.text)
    if (reply?.status === 'running') {
      continue
    }
    if (target.family !== undefined && replyLanguage(unit.text) === target.family) {
      if (isShowing(reply)) {
        tasks.push(() => setHidden($, unit.id, true))
      }
      continue
    }
    tasks.push(() => translate($, settings.model, unit.id, unit.text, target, isFresh))
  }

  return tasks
}

// Puts a final reply's whole turn in `target`, as a press on its language
// does, a few units at a time; `isFresh`, for ↻, asks the model again for
// each, whatever was kept.
async function translateTurn(
  $: EngineInterface,
  settings: Settings,
  id: string,
  text: string,
  target: Target,
  isFresh = false,
) {
  const units = await turnOfReply($, settings.translateAll, id, text)
  await runLimited(await languageTasks($, settings, units, target, isFresh), CONTROL_PARALLEL)
}

// Asks the model again for the units of a turn whose translation failed, as
// ↻ does after a failure; the rest stay as they are.
async function retryTurn($: EngineInterface, settings: Settings, id: string, text: string, target: Target) {
  const failed: FinalReply[] = []
  for (const unit of await turnOfReply($, settings.translateAll, id, text)) {
    if ((await currentReply($, unit.id, unit.text))?.status === 'error') {
      failed.push(unit)
    }
  }
  await runLimited(await languageTasks($, settings, failed, target, true), CONTROL_PARALLEL)
}

// Hides the open translations of a turn's units: the originals show again,
// each translation a press away.
async function hideTurn($: EngineInterface, ids: string[]) {
  for (const id of ids) {
    if (isShowing(await currentReply($, id))) {
      await setHidden($, id, true)
    }
  }
}

// Puts each of the last few turns in `target`, as a press on that language
// under each of their replies would.
async function translateRecent($: EngineInterface, settings: Settings, target: Target) {
  const tasks: (() => Promise<unknown>)[] = []
  for (const units of await recentTurns($, settings.controlRange, settings.translateAll)) {
    tasks.push(...(await languageTasks($, settings, units, target)))
  }
  await runLimited(tasks, CONTROL_PARALLEL)
}

// Closes the open translation of each unit of the last few turns: the
// original shows again, and each translation stays a press away.
async function hideAllTranslations($: EngineInterface, settings: Settings) {
  for (const units of await recentTurns($, settings.controlRange, settings.translateAll)) {
    for (const { id, text } of units) {
      if (isShowing(await currentReply($, id, text))) {
        await setHidden($, id, true)
      }
    }
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
    controlRange: controlRangeOf(options.controlRange),
    translateAll: options.translateAll === true || String(options.translateAll).toLowerCase() === 'true',
    showTokens: options.showTokens === true || String(options.showTokens).toLowerCase() === 'true',
    isMarkBelow: String(options.markPosition ?? 'end').trim().toLowerCase() === 'below',
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refreshUiLanguage($, settings.uiLanguage)
    await loadSpent($)
    await refresh($, settings.translateAll)
    for (const ms of RESCAN_MS) {
      $.clock.after(ms, () => {
        refresh($, settings.translateAll).catch(() => undefined)
      })
    }

    return started
  })

  // Under translateAll a note is done once the call after it starts, so the
  // notes of a long turn are translated as they come, not all at its end.
  // One catch-up at a time, on a timer: the call waits for none of it.
  let isCatchingUp = false
  on('tool.call', async ($, e, next) => {
    const primary = settings.primary
    if (settings.translateAll && primary !== undefined && e.agentId === undefined && !isCatchingUp) {
      isCatchingUp = true
      $.clock.after(1, () => {
        catchUp($, settings, primary)
          .catch(() => undefined)
          .finally(() => {
            isCatchingUp = false
          })
      })
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const latest = await refresh($, settings.translateAll, e.answer)
      await refreshUiLanguage($, settings.uiLanguage)
      const primary = settings.primary
      if (primary !== undefined && e.reason === 'answer') {
        // One call per unit of this turn that nothing was asked of yet, all
        // of a reply's blocks together; a unit of an earlier turn waits for
        // a press. The calls run on a timer, so the turn's end waits for none
        // of them, a few at a time. With autoExpand or replaceOriginal the
        // translation is the one a press makes, so it shows its progress and
        // opens by itself, under the reply or in its place.
        const tasks = await aheadTasks($, settings, primary, latest)
        if (tasks.length > 0) {
          $.clock.after(1, () => {
            runLimited(tasks, CONTROL_PARALLEL).catch(() => undefined)
          })
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

    // Under translateAll a note written between tool calls draws no buttons:
    // its turn's final reply has them, for the whole turn. The note shows its
    // own translation, in its place or under it as a reply does, and its
    // progress and failure.
    const turnMap = await read($, turns)
    if (turnMap.noteOf[blockId] !== undefined) {
      const note = await currentReply($, blockId, blockText)
      const ui = (await read($, uiLocale)) ?? uiLanguageOf(systemLocale())
      const s = STRINGS[ui] ?? EN
      const replacement =
        replacesOriginal(settings, note) && note?.language !== undefined ? note.texts[note.language] : undefined
      if (replacement !== undefined) {
        const source = replyLanguage(blockText)
        const tokens = shownTokens(settings, note)
        if (!settings.isMarkBelow) {
          return next({ ...e, props: { ...e.props, text: withMark(replacement, markOf(s, source, ui, tokens)) } })
        }
        const drawnNote = await next({ ...e, props: { ...e.props, text: replacement } })
        const { Box, Text } = $.ui.resolve(e)

        return (
          <Box key={`note-${blockId}`} flexDirection="column">
            {drawnNote}
            <Box paddingLeft={e.surface === 'desktop' ? MARK_LINE_INSET : 0}>
              <Text dimColor size="caption">
                {lineMarkOf(s, source, ui, tokens)}
              </Text>
            </Box>
          </Box>
        )
      }
      if (note === undefined || note.status === undefined || (note.status === 'done' && !isShowing(note))) {
        return next(e)
      }
      const name = note.language === undefined ? '' : nameOf(note.language, ui)
      const original = await next(e)
      const { Box, Markdown, Progress, Text } = $.ui.resolve(e)
      const panel =
        note.status === 'running' ? (
          <Progress label={`${s.translating} · ${name}`} />
        ) : note.status === 'error' ? (
          <Text color="error">{s.failed.replace('{reason}', s.reasons[note.error ?? ''] ?? note.error ?? '')}</Text>
        ) : (
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text dimColor>{headingOf(s, name, shownTokens(settings, note), ui)}</Text>
            <Markdown text={note.texts[note.language ?? ''] ?? ''} />
          </Box>
        )

      return (
        <Box key={`note-${blockId}`} flexDirection="column">
          {original}
          <Box marginTop="sm">{panel}</Box>
        </Box>
      )
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
    // Under translateAll the notes of the reply's turn go with it: its
    // buttons show the turn's state and act on all of its units.
    const notes = settings.translateAll ? (turnMap.notesOf[id] ?? []) : []
    const noteReplies: (Reply | undefined)[] = []
    for (const note of notes) {
      noteReplies.push(await currentReply($, note.id))
    }
    const units = [reply, ...noteReplies]
    const ownLanguage = replyLanguage(text)
    // A turn in the main language needs no translation: leave the reply as
    // the engine draws it, unless a translation of the turn was asked for
    // already.
    const primary = settings.primary
    if (
      settings.skipPrimaryReplies &&
      primary !== undefined &&
      ownLanguage === primary.family &&
      notes.every(note => note.language === undefined || note.language === primary.family) &&
      units.every(unit => unit?.status === undefined)
    ) {
      return next(e)
    }
    const ui = (await read($, uiLocale)) ?? uiLanguageOf(systemLocale())
    const s = STRINGS[ui] ?? EN
    // With replaceOriginal an open translation is drawn where the reply was,
    // and by the engine itself, as it draws the reply: the same type, spacing
    // and width, with a mark at its end for what it was translated from. Only
    // the drawing changes; the stored message stays as it is.
    const replacement =
      replacesOriginal(settings, reply) && reply?.language !== undefined ? reply.texts[reply.language] : undefined
    const mark = replacement === undefined ? undefined : markOf(s, ownLanguage, ui, shownTokens(settings, reply))
    const drawn = await next(
      replacement === undefined || mark === undefined
        ? e
        : { ...e, props: { ...e.props, text: settings.isMarkBelow ? replacement : withMark(replacement, mark) } },
    )
    const { Box, Button, Markdown, Progress, Text } = $.ui.resolve(e)
    // With markPosition below, the mark on a small line of its own, lined up
    // with the text.
    const markLine =
      settings.isMarkBelow && mark !== undefined ? (
        <Box paddingLeft={e.surface === 'desktop' ? MARK_LINE_INSET : 0}>
          <Text dimColor size="caption">
            {lineMarkOf(s, ownLanguage, ui, shownTokens(settings, reply))}
          </Text>
        </Box>
      ) : undefined

    const targets = targetsFor(settings, ui)
    const offered = turnTargets(targets, [ownLanguage, ...notes.map(note => note.language)])
    const targetOf = (key: string | undefined): Target | undefined =>
      targets.find(target => target.key === key) ??
      (key === undefined ? undefined : { key, promptName: key })
    const label = (target: Target) => (target.family === undefined ? target.key : nameOf(target.key, ui))
    const ids = [...notes.map(note => note.id), id]
    // The turn's mode, which its buttons mark: its button checked and at full
    // strength, the rest dim. Original, or the language it shows. A press on a
    // language puts the whole turn in it, one language at a time; Original
    // shows the turn as written.
    const parts: Part[] = [
      { language: ownLanguage, reply },
      ...notes.map((note, i): Part => ({ language: note.language, reply: noteReplies[i] })),
    ]
    const mode = modeOf(parts)
    const segment = (key: string, name: string, onPress: () => Promise<void>) => (
      <Button
        key={`mode-${key === ORIGINAL ? 'original' : key}-${id}`}
        label={key === mode ? markedLabel(name) : name}
        dimColor={key !== mode}
        onPress={onPress}
      />
    )
    const modes = [
      segment(ORIGINAL, s.original, () => hideTurn($, ids)),
      ...offered.map(target => segment(target.key, label(target), () => translateTurn($, settings, id, text, target))),
    ]
    const failed = units.find(unit => unit?.status === 'error')
    const failedTarget = targetOf(failed?.language)

    let panel
    let toolbar
    // While a translation of the turn is open its buttons stay, hover or not.
    const isOpen = mode !== ORIGINAL
    // With replaceOriginal, an open translation is drawn where the reply was.
    const isReplaced = replacement !== undefined
    if (units.some(unit => unit?.status === 'running')) {
      // Each unit shows its own progress; the buttons wait for them all.
      const running = targetOf(reply?.status === 'running' ? reply.language : undefined)
      if (running !== undefined) {
        panel = <Progress label={`${s.translating} · ${label(running)}`} />
      }
    } else {
      // ↻ asks the model again: after a failure for the failed units, else
      // for the whole turn in the language it shows.
      const shown = mode === ORIGINAL ? undefined : targetOf(mode)
      const refresh = (onPress: () => Promise<void>) => (
        <Button key={`refresh-${id}`} label={REFRESH} dimColor onPress={onPress} />
      )
      toolbar = shown === undefined ? modes : [...modes, refresh(() => translateTurn($, settings, id, text, shown, true))]
      if (failed !== undefined && failedTarget !== undefined) {
        const retry = refresh(() => retryTurn($, settings, id, text, failedTarget))
        toolbar = modes
        if (reply?.status === 'error') {
          const reason = s.reasons[failed.error ?? ''] ?? failed.error ?? ''
          panel = (
            <Box flexDirection="row" gap="sm">
              <Text color="error">{s.failed.replace('{reason}', reason)}</Text>
              {retry}
            </Box>
          )
        } else {
          // A note failed: it says why under itself.
          toolbar = [...modes, retry]
        }
      }
      const shownIn = isShowing(reply) ? targetOf(reply?.language) : undefined
      const translated = shownIn === undefined ? undefined : reply?.texts[shownIn.key]
      // In the reply's place the engine draws the translation (`drawn`), its
      // mark at its end: no panel.
      if (shownIn !== undefined && translated !== undefined && !isReplaced) {
        panel = (
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text dimColor>{headingOf(s, label(shownIn), shownTokens(settings, reply), ui)}</Text>
            <Markdown text={translated} />
          </Box>
        )
      }
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
        {drawn}
        {markLine}
        {panel === undefined ? undefined : <Box marginTop="sm">{panel}</Box>}
        {bar}
      </Box>
    )
  })

  // The band above the prompt: one row that opens or closes the translations
  // of the last few final replies at once. Only the main conversation's view
  // gets it, and a survey holding the band comes first.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (settings.controlRange <= 0 || e.props.hasSurvey || e.props.view.agentId !== undefined) {
      return next(e)
    }
    // Replies with buttons: a block of its own, or the last block of a reply;
    // a note goes with its reply and is not counted.
    const known = await read($, finals)
    const grouped = await read($, groups)
    const turnMap = await read($, turns)
    const replyIds = known
      .filter(blockId => grouped[blockId]?.isLast !== false && turnMap.noteOf[blockId] === undefined)
      .map(blockId => grouped[blockId]?.reply ?? blockId)
    if (replyIds.length === 0) {
      return next(e)
    }
    const ui = (await read($, uiLocale)) ?? uiLanguageOf(systemLocale())
    const s = STRINGS[ui] ?? EN
    const recent = replyIds.slice(-settings.controlRange)
    const shown = recent.length
    const targets = targetsFor(settings, ui)
    // The mode every recent turn is in, which the band marks; none when they
    // differ.
    const turnParts: Part[][] = []
    for (const replyId of recent) {
      const notes = settings.translateAll ? (turnMap.notesOf[replyId] ?? []) : []
      const parts: Part[] = [{ language: turnMap.languageOf[replyId], reply: await currentReply($, replyId) }]
      for (const note of notes) {
        parts.push({ language: note.language, reply: await currentReply($, note.id) })
      }
      turnParts.push(parts)
    }
    // With showTokens the band says what the translations of its replies
    // have taken, and of the whole session so far.
    const total = settings.showTokens ? await sessionTotal($) : undefined
    const { Box, Button, Text } = $.ui.resolve(e)
    const range = shown === 1 ? s.recentOne : s.recent.replace('{count}', String(shown))
    const recentSpent = turnParts.flat().reduce((sum, part) => sum + (part.reply?.spent ?? 0), 0)
    const label =
      total === undefined
        ? range
        : [
            s.recentTokens.replace('{range}', range).replace('{tokens}', countOf(s, recentSpent, ui)),
            s.total.replace('{tokens}', countOf(s, total, ui)),
          ].join(' · ')
    // Seen in use: with only Chinese replies in range, Simplified Chinese did
    // nothing at all. Only a language some recent part is not written in is
    // offered, as under a reply; with none to offer the band draws no
    // buttons, only the total when there is one to show.
    const offered = targets.filter(target =>
      turnParts.some(parts =>
        parts.some(part => target.family === undefined || part.language === undefined || part.language !== target.family),
      ),
    )
    if (offered.length === 0) {
      return total === undefined || total === 0 ? (
        next(e)
      ) : (
        <Box flexDirection="row" gap="sm">
          <Text dimColor>{label}</Text>
        </Box>
      )
    }
    const mode = sharedMode(turnParts, offered)
    const segment = (key: string, name: string, onPress: () => Promise<void>) => (
      <Button
        key={`rt-${key === ORIGINAL ? 'original' : key}`}
        label={key === mode ? markedLabel(name) : name}
        dimColor={key !== mode}
        onPress={onPress}
      />
    )


    // What the row acts on, and the counts, at its left; the buttons at its
    // right end, as the user laid it out.
    return (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm" width="100%">
        <Text dimColor>{label}</Text>
        <Box flexDirection="row" gap="sm">
          {segment(ORIGINAL, s.original, () => hideAllTranslations($, settings))}
          {offered.map(target =>
            segment(
              target.key,
              target.family === undefined ? target.key : nameOf(target.key, ui),
              () => translateRecent($, settings, target),
            ),
          )}
        </Box>
      </Box>
    )
  })
}
