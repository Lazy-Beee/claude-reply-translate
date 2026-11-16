# Changelog

All notable changes to reply-translate. Versions follow the `version` in `.claude-plugin/plugin.json`.

## 0.9.1 (2026-11-16)

### Changed

- With `replaceOriginal`, a translation in the reply's place ends with a short italic mark on its last line, such as *(translated from English)*, in the interface language, instead of a heading line above it.
  - Notes translated in place under `translateAll` carry the mark too, so every translated part of a turn says so, including a turn whose reply was already in your language.
  - After a code block, a table, a rule or a heading the mark starts a paragraph of its own. **Copy** still copies the translation alone.

## 0.9.0 (2026-11-16)

### Added

- `translateAll` (default `false`): the notes Claude writes between tool calls while it works are translated too, not only its final reply.
  - A note gets no buttons of its own. The buttons under its turn's final reply act on the whole turn: a language puts every note and the reply in it, and **Show original** or **Hide translation** covers them all.
  - A reply in the main language keeps its buttons when its turn's notes are in another language.
  - With a main language set, each note is translated as soon as the tool call after it starts, so the notes of a long turn read in your language while it runs.
  - The row above the prompt acts on whole turns and counts replies, not notes.
  - Notes a model writes as thinking that the desktop shows as text are left as they are: the desktop draws them itself, where a mod cannot draw a translation over them. Thinking is never translated.

### Fixed

- As a turn ends, only that turn's replies are translated ahead, each once. A reply of an earlier turn that the mod meets only then, such as one in a history that loaded late, waits for a press instead of costing a call.
- The translations made as a turn ends run at most four at a time.

## 0.8.0 (2026-11-15)

### Added

- A row above the prompt shows or hides the translations of the last few final replies at once.
  - **Show translations** opens a translation on each. One shown before shows again. A reply with none is translated into its main target, at most four at a time.
  - With a main language set, replies already in it are skipped.
  - The other button shows the originals again: **Show originals** with `replaceOriginal`, else **Hide translations**.
- `controlRange` (default `10`): how many of the latest final replies the row acts on, so a long conversation costs no more than a short one. `0` draws no row.

## 0.7.0 (2026-11-15)

### Added

- `replaceOriginal`: an open translation, in any language, takes the place of the reply, so each reply shows in one language at a time.
  - **Show original** brings the reply back.
  - With a main language set, replies in other languages are translated into it as each turn ends and shown in their place, with no press.
  - The translation in place is drawn by Claude Code itself, in the same type, spacing and width as the reply.
- `skipPrimaryReplies`: a reply already in the main language gets no buttons and no room for them.
- `alwaysShowButtons` (default `true`): the buttons always show. Set it to `false` to show them only while the pointer is over the reply, on the desktop.

### Changed

- A reply written as several text blocks gets one set of buttons, under its last block, and is translated as a whole.
- The model writes the translation inside `<translation>` tags. Anything it writes outside them, such as a remark about the text, is dropped.
- The prompt names the reply's own language, so Japanese written mostly in kanji is not taken for Chinese.

### Fixed

- A translation that comes back still in the reply's own language is asked for once more, then shown as a failure (`the reply came back untranslated`) instead of as a translation. One kept by an earlier version is skipped, and the reply is offered afresh.

### Removed

- `showButtons` is no longer read. Use `alwaysShowButtons` instead. The buttons now always show unless it is `false`; in 0.6.0 they showed only on hover by default.

## 0.6.0 (2026-11-15)

First public release.

- Translate buttons under Claude's final reply of each turn, in the desktop app's Code tab. Text written between tool calls gets none.
- One button per target language (`languages`, default `auto`: the button language, then English). The main button is the first target that is not the reply's own language.
- Optional main language (`primaryLanguage`): replies in other languages are translated into it in the background as each turn ends. `autoExpand` opens those translations by themselves.
- Button text in English, Simplified and Traditional Chinese, Japanese, Korean, Spanish, French and German (`uiLanguage`, default `auto`).
- Translations are cached by language and kept between sessions, about 2 MB in all.
- `showButtons` (default `hover`): on the desktop, the buttons show while the pointer is over the reply.
