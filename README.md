# claude-reply-translate

[中文说明](README.zh-CN.md)

A Claude Code mod that adds translate buttons under Claude's **final reply** of each turn in the desktop app's Code tab. The text Claude writes between tool calls while it works gets no buttons. It installs as the plugin `reply-translate`.

```
[✓ Original] [Simplified Chinese] [English]
```

- **Pick a language, get a translation.** Under each final reply sit **Original** and a button for each target language; the one checked (✓) is what the reply shows now. A language shows the reply in it, **Original** shows it as written. The translation opens in a bordered box under the reply. Code blocks, inline code, commands, file paths, URLs and identifiers are left as they are.
- **Checked, and made again on request.** A translation that comes back in the reply's own language, or far shorter than the reply, is asked for once more, then shown as failed. **↻** asks the model again: after a failure, or over a translation that came out wrong.
- **Only the languages it needs.** A language the reply is written in gets no button. The reply's language is worked out locally from its prose, so an English reply offers Chinese and a Chinese reply offers English.
- **Always at hand, or out of the way.** The buttons always show by default. Turn `alwaysShowButtons` off and, on the desktop, they show only while the pointer is over the reply, floating in a fixed strip, so showing them does not shift the conversation.
- **Each language is translated once per reply.** Translations are cached by language and kept between sessions.
- **Ready before you ask (optional).** Set a main language and replies in other languages are translated into it in the background as each turn ends. With `autoExpand` on, the translation opens by itself.
- **Read in your language (optional).** With `replaceOriginal` on, a translation takes the place of the reply instead of opening under it, so each reply shows in one language at a time. **Original** brings the reply back. With a main language set too, replies in other languages are translated into it as each turn ends and shown in its place, with no press. A translation in place ends with a short mark on its last line, such as *(translated from English)*, so you can tell it from what Claude wrote.
- **Everything Claude writes (optional).** With `translateAll` on, the notes Claude writes between tool calls while it works are translated too. They get no buttons of their own: the buttons under the turn's final reply act on the whole turn, notes included, and the row above the prompt on the last few turns.
- **All recent replies at once.** A row above the prompt has the same buttons for the last few final replies (10 by default): one press puts them all in a language, or back as written. Its checked button is the language they all read in; when they differ, none is. A language none of them can be put in, such as Chinese when they are all written in Chinese, gets no button. Only those replies are touched, so a long conversation costs no more than a short one.
- **See what it costs (optional).** With `showTokens` on, each translation says how many tokens it took, and the row above the prompt shows what the recent replies took and the total for the session.
- **Buttons in your language.** The button text follows Claude Code's `language` setting, then the system language. It is available in English, Simplified and Traditional Chinese, Japanese, Korean, Spanish, French and German.

## Requirements

- The Claude desktop app's Code tab, on a Claude Code version that runs mods (hooks modules). Tested with Claude Code 2.1.325 on Windows.
- The mod API is early access, so a Claude Code update may need a matching update here.
- Tested in the desktop app. The terminal draws the buttons too, always visible, but only the tests cover it. Sessions viewed through Remote Control (on the web, the phone or another computer) show no buttons.

## Install

In a terminal session of Claude Code:

```
/plugin install reply-translate --marketplace Lazy-Beee/claude-reply-translate
```

It asks to add the marketplace, then shows a screen where you can set the options.

In the desktop app, click **+** next to the prompt box, choose **Plugins**, add the marketplace `Lazy-Beee/claude-reply-translate`, then add **reply-translate**.

### From a local folder

To run a copy you are working on, point Claude Code at the plugin folder in `~/.claude/settings.json`:

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-reply-translate",
  "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
}
```

The setting takes effect in sessions started afterwards, in every session. With the watch flag on, a running session reloads the mod when its files change. Several folders are separated with `;`. If you also installed the mod from the marketplace, disable that copy (`claude plugin disable reply-translate@reply-translate`), so it does not load twice.

## Configure

Options live in `~/.claude/settings.json` under `pluginConfigs`, keyed by the plugin's id: `reply-translate@reply-translate` when it is installed from the marketplace, and `reply-translate` when it is loaded from a folder. Any option you leave out keeps its default. Start a new session after a change.

```json
"pluginConfigs": {
  "reply-translate@reply-translate": {
    "options": {
      "languages": "zh-CN, en",
      "primaryLanguage": "zh-CN",
      "autoExpand": false,
      "replaceOriginal": false,
      "skipPrimaryReplies": false,
      "uiLanguage": "auto",
      "alwaysShowButtons": true,
      "translateAll": false,
      "controlRange": 10,
      "model": "haiku",
      "showTokens": false,
      "markPosition": "end"
    }
  }
}
```

| Option | Default | What it does |
| --- | --- | --- |
| `languages` | `auto` | The languages to translate into, comma-separated: tags such as `zh-CN`, `zh-TW`, `en`, `ja`, or names such as `Japanese`. Each gets a button, in this order. `auto` means the button language, then English. |
| `primaryLanguage` | empty (off) | Your own language. As each turn ends, a final reply in another language is translated into it in the background, so pressing the button shows it at once. It also comes first among the targets. |
| `autoExpand` | `false` | Needs a main language. When on, those background translations open by themselves, with a progress bar while they run. |
| `replaceOriginal` | `false` | When on, a translation in any language is shown in place of the reply rather than under it, so the reply shows in one language at a time. **Original** brings the reply back. With a main language set, the translation into it is also made as each turn ends and shown with no press; this wins over `autoExpand`. A translation in place ends with a mark such as *(translated from English)* on its last line, in the interface language; after a code block, a table or a heading it takes a line of its own. `markPosition` can put it on a small line under the translation instead. |
| `uiLanguage` | `auto` | The language of the buttons. `auto` follows Claude Code's `language` setting, then the system language. You can also give a tag such as `zh-CN`. |
| `skipPrimaryReplies` | `false` | Needs a main language. When on, a reply already in your main language is left as it is: no buttons, and no room kept for them. A reply that has a translation open already still shows it. |
| `alwaysShowButtons` | `true` | `true`: the buttons always show. `false`: on the desktop, they show only while the pointer is over the reply. |
| `translateAll` | `false` | When on, the notes Claude writes between tool calls are translated too. A note has no buttons: the buttons under its turn's final reply put the whole turn in one language, and **Original** shows all of it as written. A reply in your main language keeps its buttons when its notes are not. The notes show their translations as the reply does: in their place with `replaceOriginal`, else under them. With a main language set, each note is translated as soon as the tool call after it starts. |
| `controlRange` | `10` | How many of the latest final replies the row above the prompt acts on. A language puts each of them in it, as its own button does: a translation made before costs no call, one without one model call each, and a reply written in that language shows as it is. **Original** shows them all as written. `0` draws no row. |
| `model` | `haiku` | The model used to translate: an alias or a full model id. |
| `showTokens` | `false` | When on, each translation says how many tokens it took, counting every call that made it, a second try included: in its mark in the reply's place, such as *(translated from English, 1,234 tokens)*, else in its heading. After its label, the row above the prompt shows what the translations of the replies it acts on have taken, then what all of the session's translations have taken so far, failed calls and translations made again included: *Last 10 replies: 3,456 tokens · Session total: 12,345 tokens*. The count is input and output tokens together, cached input included. A translation made before 0.12.0 shows no count. |
| `markPosition` | `end` | Where a translation in the reply's place says what it was translated from, and with `showTokens` the tokens it took. `end`: in italics at the end of its last line, in brackets. `below`: in small dim type on a line of its own under it, with no brackets, such as *Translated from English · 1,234 tokens*. The reply's text has no type size of its own, so only a line of its own can be smaller. |

You can also set them from a shell. Every value is given as a string:

```
echo '{"languages":"zh-CN, en","primaryLanguage":"zh-CN","autoExpand":"true"}' | claude plugin configure reply-translate@reply-translate --values-stdin
```

`claude plugin configure reply-translate@reply-translate` on its own lists the options and which ones are set. In a terminal session, `/plugin configure` and `/config` list them too.

## Cost

Translations run through your session's own model client and credentials. On a Claude subscription they count toward your plan's usage; with an API key they are billed to your account. Each call shows in `/cost`. With a main language set, every final reply in another language costs one call, whether or not you open it. A language pressed above the prompt costs one call for each of the recent replies that has no translation into it yet, `controlRange` of them at most. With `translateAll` and a main language, every note Claude writes in another language costs one call too. Turn on `showTokens` to see the tokens each translation took and the session's total.

## How it works

- The mod reads the session's transcript to find the final replies: the text of a model response that calls no tool. It remembers their fingerprints, and only those replies get buttons. A reply written as several text blocks gets one set of buttons, under its last block, and is translated as a whole.
- It draws the buttons by wrapping the engine's own drawing of each final reply (`ui.render` on `AssistantMessage`). The stored message is never changed.
- A translation is one `$.model.complete` call with no history and no tools. The reply is wrapped in `<reply>` tags, so the model reads it as data. The model writes the translation inside `<translation>` tags, and anything it writes outside them, such as a remark about the text, is dropped. An answer still in the reply's own language is asked for once more, then shown as a failure rather than as a translation.
- Translations live in the session's state and in the mod's own store, which is kept between sessions. The store holds about 2 MB, and the oldest translations are dropped first.

## Known limitations

- The reply's language is recognised for Chinese, Japanese, Korean and English. For any other language, every target is offered.
- With `alwaysShowButtons` off, each final reply keeps a strip about two lines high for the buttons, even when they are hidden.
- Sessions viewed through Remote Control show no buttons.
- With `translateAll`, notes a model writes as thinking that the desktop shows as text stay as written: the desktop draws them itself, out of a mod's reach. Only notes written as text are translated.

## Develop

```
claude plugin validate .
claude plugin test .
```

- `validate` checks the manifest, scans the hooks module and type-checks it.
- `test` runs `hooks/register.test.tsx`.
- Use a Claude Code version that runs mods. An older `claude` on your PATH may reject the `"types"` and `"modules"` fields.
- When Claude Code loads the mod from a folder, it writes the API types into `.claude-plugin/types/`. Point your editor at them, and do not commit or edit them.
- Keep the folder you edit apart from the folder Claude Code loads the mod from. In auto mode, Claude Code may refuse to judge writes into a plugin folder that the same session has loaded.

## License

[MIT](LICENSE)
