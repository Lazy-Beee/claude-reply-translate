# reply-translate

[中文说明](README.zh-CN.md)

A Claude Code mod that adds translate buttons under Claude's **final reply** of each turn in the desktop app's Code tab. The text Claude writes between tool calls while it works gets no buttons.

```
[Translate · Simplified Chinese] [English]
```

- **Pick a language, get a translation.** The translation opens in a bordered box under the reply. Code blocks, inline code, commands, file paths, URLs and identifiers are left as they are.
- **The main button picks the target for you.** It is the first of your target languages that is not the reply's own language. The reply's language is worked out locally from its prose, so an English reply offers Chinese and a Chinese reply offers English.
- **Out of the way until you need it.** On the desktop the buttons show while the pointer is over the reply. They float in a fixed strip, so showing them does not shift the conversation.
- **Each language is translated once per reply.** Translations are cached by language and kept between sessions.
- **Ready before you ask (optional).** Set a main language and replies in other languages are translated into it in the background as each turn ends. With `autoExpand` on, the translation opens by itself.
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

The setting takes effect in sessions started afterwards, in every session. With the watch flag on, a running session reloads the mod when its files change. Several folders are separated with `;`.

## Configure

Options live in `~/.claude/settings.json` under `pluginConfigs`. Any option you leave out keeps its default. A saved change reloads the mod. The key is the plugin's id: `reply-translate@reply-translate` when it is installed from the marketplace, and `reply-translate` when it is loaded from a folder.

```json
"pluginConfigs": {
  "reply-translate": {
    "options": {
      "languages": "zh-CN, en",
      "primaryLanguage": "zh-CN",
      "autoExpand": false,
      "uiLanguage": "auto",
      "showButtons": "hover",
      "model": "haiku"
    }
  }
}
```

| Option | Default | What it does |
| --- | --- | --- |
| `languages` | `auto` | The languages to translate into, comma-separated: tags such as `zh-CN`, `zh-TW`, `en`, `ja`, or names such as `Japanese`. Each gets a button, and their order decides the main one. `auto` means the button language, then English. |
| `primaryLanguage` | empty (off) | Your own language. As each turn ends, a final reply in another language is translated into it in the background, so pressing the button shows it at once. It also comes first among the targets. |
| `autoExpand` | `false` | Needs a main language. When on, those background translations open by themselves, with a progress bar while they run. |
| `uiLanguage` | `auto` | The language of the buttons. `auto` follows Claude Code's `language` setting, then the system language. You can also give a tag such as `zh-CN`. |
| `showButtons` | `hover` | `hover`: on the desktop, the buttons show only while the pointer is over the reply. `always`: they always show. |
| `model` | `haiku` | The model used to translate: an alias or a full model id. |

The desktop Code tab has no `/config` menu, so edit the file. In a terminal session, `/config` lists the options too.

## Cost

Translations run through your session's own model client and credentials. On a Claude subscription they count toward your plan's usage; with an API key they are billed to your account. Each call shows in `/cost`. With a main language set, every final reply in another language costs one call, whether or not you open it.

## How it works

- The mod reads the session's transcript to find the final replies: the text of a model response that calls no tool. It remembers their fingerprints, and only those blocks get buttons.
- It draws the buttons by wrapping the engine's own drawing of each final reply (`ui.render` on `AssistantMessage`). The stored message is never changed.
- A translation is one `$.model.complete` call with no history and no tools. The reply is wrapped in `<reply>` tags, so the model reads it as data.
- Translations live in the session's state and in the mod's own store, which is kept between sessions. The store holds about 2 MB, and the oldest translations are dropped first.

## Known limitations

- A final reply made of several text blocks gets one set of buttons per block.
- The reply's language is recognised for Chinese, Japanese, Korean and English. For any other language, every target is offered.
- In hover mode each final reply keeps a strip about two lines high for the buttons, even when they are hidden.
- Sessions viewed through Remote Control show no buttons.

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
