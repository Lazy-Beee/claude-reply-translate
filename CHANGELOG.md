# Changelog

All notable changes to reply-translate. Versions follow the `version` in `.claude-plugin/plugin.json`.

## 0.12.1 (2026-11-19)

### Fixed

- On the desktop, a formula that a translation put right beside markup, such as `**第 5.1 节:**$t_{\mathrm{mix}}$`, was drawn as plain text, and its underscores, read as italics, broke the other formulas of the line. Where the reply has a space beside a formula, the translation gets one too when it is drawn, so translations kept before are drawn right as well. Code blocks and inline code keep their dollars as they are. The prompt also asks the model to keep formulas and the space around them.

## 0.12.0 (2026-11-17)

### Added

- `showTokens` (default `false`): each translation says how many tokens it took, every call that made it counted, a second try included. In the reply's place the count goes in the mark at its end, such as *(translated from English, 1,234 tokens)*; under the reply, in the translation's heading. After its label, the row above the prompt shows what the translations of its replies have taken, then the total for the whole session so far, failed calls and translations made again included: *Last 10 replies: 3,456 tokens · Session total: 12,345 tokens*.
  - The count is input and output tokens together, cached input included.
  - Counts are kept with the translations, each reply's with it, and the session's total in the mod's store, so a reopened session goes on from it. After `/clear` the new session counts from nothing. The totals of the latest 100 sessions are kept.
  - A translation made before this version shows no count.
- `markPosition` (default `end`): `below` puts the mark of a translation in the reply's place on a line of its own under it, in small dim type, with no brackets, such as *Translated from English · 1,234 tokens*. The reply's text has no type size of its own, and the desktop draws no HTML in it, so the mark can only be smaller on a line of its own.

### Changed

- The buttons of the row above the prompt sit at its right end; its label stays at the left.

## 0.11.0 (2026-11-16)

### Added

- **↻** under a turn's buttons asks the model again: after a failure, for the parts that failed, and over an open translation, for the whole turn in the language it shows. It replaces **Retry**.

### Fixed

- A translation far shorter than its reply (under 15 % of a reply of 200 characters or more) is no longer taken: it is asked for once more, saying the first answer was no full translation, then shown as failed with "the translation came back incomplete". Seen in use: asked for a 2,000-character note, Haiku answered with a few lines on how it would translate it, which replaced the note. Such a translation kept by an earlier version is left out when read, so the reply is offered afresh.
- The prompt asks the model to start its answer with the translation tag and to write no plan.

## 0.10.0 (2026-11-16)

### Changed

- The buttons under a reply are **Original** and one for each target language, with a ✓ on the one for what the turn shows now. A language puts the whole turn in it, from translations made before where it can; **Original** shows it as written. They replace **Translate · …**, **Hide translation**, **Show original** and **Show translation**, whose meaning changed with what was open.
  - A turn shows one language at a time. Before, showing a hidden translation again brought each part back in the language it was last in, so a turn put in English and hidden came back with its notes in Chinese and its reply in English.
- The row above the prompt has the same buttons for the recent replies: a language puts them all in it, **Original** shows them all as written, and the checked button is the language they all read in, or none when they differ. A language none of them can be put in gets no button, so the row never shows one that does nothing. It replaces **Show translations**, **Show originals** and **Hide translations**.

### Removed

- The **Copy** button under an open translation. To copy a translation, select its text.

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
