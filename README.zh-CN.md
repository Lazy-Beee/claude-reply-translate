# reply-translate

[English](README.md)

一个 Claude Code mod：在桌面应用的 Code 标签页里，给 Claude 每轮的**最终回复**加上翻译按钮。Claude 工作过程中、工具调用之间写的文字不加按钮。

```
[翻译 · 简体中文] [英语]
```

- **点哪种语言，就翻成哪种语言。** 译文显示在回复下方的带边框框里。代码块、行内代码、命令、文件路径、URL 和标识符都保持原样。
- **主按钮自动选目标语言。** 主按钮是目标语言中第一个和回复本身语言不同的那个。回复是什么语言，在本地根据正文判断：英文回复给出中文，中文回复给出英文。
- **不用的时候不占地方。** 在桌面端，鼠标移到回复上才显示按钮。按钮浮在一条固定的空白条里，出现和消失都不会挪动对话。
- **每条回复的每种语言只翻一次。** 译文按语言缓存，换会话也还在。
- **可以提前翻好（可选）。** 设了主要语言后，每轮结束时，不是主要语言的回复会在后台先翻好。再打开 `autoExpand`，译文会自己展开。
- **按钮文字用你的语言。** 按钮上的文字跟随 Claude Code 的 `language` 设置，没设就跟随系统语言。支持英文、简体中文、繁体中文、日文、韩文、西班牙文、法文、德文。

## 要求

- Claude 桌面应用的 Code 标签页，并且 Claude Code 版本支持 mod（hooks 模块）。在 Windows 上用 Claude Code 2.1.325 测试过。
- mod 的 API 还是 early access，Claude Code 更新后，这里可能也要跟着更新。
- 在桌面应用里测试过。终端里也会画出按钮（一直显示），但只有自动测试覆盖到。通过 Remote Control（网页、手机或另一台电脑）查看的会话不显示按钮。

## 安装

在终端版 Claude Code 里运行：

```
/plugin install reply-translate --marketplace Lazy-Beee/claude-reply-translate
```

它会先问是否添加这个 marketplace，然后出现一个设置选项的界面。

在桌面应用里：点输入框旁边的 **+**，选 **Plugins**，添加 marketplace `Lazy-Beee/claude-reply-translate`，再添加 **reply-translate**。

### 从本地文件夹加载

想运行自己正在改的副本，就在 `~/.claude/settings.json` 里把 Claude Code 指向插件文件夹：

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-reply-translate",
  "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
}
```

这个设置对之后新开的会话生效，而且所有会话都会加载。打开 watch 后，文件一改，正在运行的会话就会重新加载这个 mod。多个文件夹用 `;` 分隔。

## 配置

选项写在 `~/.claude/settings.json` 的 `pluginConfigs` 下。没写的选项用默认值。保存后 mod 会自动重新加载。键是插件的 id：从 marketplace 安装的是 `reply-translate@reply-translate`，从文件夹加载的是 `reply-translate`。

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

| 选项 | 默认值 | 作用 |
| --- | --- | --- |
| `languages` | `auto` | 要翻译成的语言，逗号分隔。可以写语言标签（`zh-CN`、`zh-TW`、`en`、`ja`），也可以写名字（比如 `Japanese`）。每种语言一个按钮，顺序决定哪个是主按钮。`auto` 表示按钮文字的语言，再加上英语。 |
| `primaryLanguage` | 空（关闭） | 你自己的语言。每轮结束时，如果最终回复是别的语言，就在后台先翻成它，点按钮时马上显示。它也总排在目标语言第一位。 |
| `autoExpand` | `false` | 需要先设主要语言。打开后，后台翻好的译文会自己展开，翻译时显示进度条。 |
| `uiLanguage` | `auto` | 按钮文字的语言。`auto` 跟随 Claude Code 的 `language` 设置，没设就跟随系统语言；也可以直接写标签，比如 `zh-CN`。 |
| `showButtons` | `hover` | `hover`：在桌面端，鼠标在回复上时才显示按钮。`always`：一直显示。 |
| `model` | `haiku` | 用来翻译的模型，写别名或完整的模型 id。 |

桌面版 Code 标签页里没有 `/config` 菜单，所以要直接改文件。在终端版里，`/config` 也会列出这些选项。

## 费用

翻译走的是你会话自己的模型客户端和凭据。用 Claude 订阅登录时，算在 plan 的用量里；用 API key 时，按 API 计费。每次调用都会显示在 `/cost` 里。设了主要语言后，每条非主要语言的最终回复都会多一次调用，不管你最后看不看。

## 工作原理

- mod 读取会话的对话记录来找出最终回复：不调用任何工具的那次模型响应里的文字。它记下这些文字的指纹，只有这些文本块才有按钮。
- 按钮是这样加上去的：把引擎对每条最终回复的绘制包一层（`AssistantMessage` 上的 `ui.render`）。存储的消息本身不会被改动。
- 每次翻译是一次 `$.model.complete` 调用，没有历史，也不带工具。回复用 `<reply>` 标记包起来，让模型把它当数据读。
- 译文存在会话状态里，也存在 mod 自己的存储里，换会话也保留。存储上限约 2 MB，超出时先删最旧的。

## 已知限制

- 一条最终回复如果由几个文本块组成，每个块各有一组按钮。
- 回复语言只认得出中文、日文、韩文、英文。其他语言的回复，所有目标语言都会给出。
- 在悬停模式下，每条最终回复下面都留着一条约两行高的空白放按钮，按钮隐藏时也占着。
- 通过 Remote Control 查看的会话不显示按钮。

## 开发

```
claude plugin validate .
claude plugin test .
```

- `validate` 会检查清单、扫描 hooks 模块并做类型检查。
- `test` 运行 `hooks/register.test.tsx`。
- 要用支持 mod 的 Claude Code 版本。PATH 上较旧的 `claude` 可能不认 `"types"` 和 `"modules"` 字段。
- Claude Code 从文件夹加载 mod 时，会把 API 类型写到 `.claude-plugin/types/`。编辑器可以用它们，但不要提交，也不要修改。
- 改代码的文件夹，最好和 Claude Code 加载 mod 的文件夹分开。在 auto 模式下，如果同一个会话已经加载了这个插件文件夹，Claude Code 可能会拒绝判定对它的写入。

## 许可证

[MIT](LICENSE)
