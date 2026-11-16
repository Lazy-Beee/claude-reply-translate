# claude-reply-translate

[English](README.md)

一个 Claude Code mod：在桌面应用的 Code 标签页里，给 Claude 每轮的**最终回复**加上翻译按钮。Claude 工作过程中、工具调用之间写的文字不加按钮。安装后的插件名是 `reply-translate`。

```
[✓ 原文] [简体中文] [英语]
```

- **点哪种语言，就翻成哪种语言。** 每条最终回复下面有 **原文** 和每种目标语言各一个按钮，打了 ✓ 的那个就是回复现在显示的。点语言就显示成那种语言，点 **原文** 就显示原来写的。译文显示在回复下方的带边框框里。代码块、行内代码、命令、文件路径、URL 和标识符都保持原样。
- **会检查，也能重新翻。** 译文还是原文语言，或者比原文短得多，会再问一次模型，还不行就显示失败。点 **↻** 让模型重新翻：失败之后，或者觉得译文不对时都可以。
- **只给需要的语言。** 回复本身就是的语言不给按钮。回复是什么语言，在本地根据正文判断：英文回复给出中文，中文回复给出英文。
- **按钮一直在手边，也可以收起来。** 按钮默认一直显示。把 `alwaysShowButtons` 关掉后，在桌面端，鼠标移到回复上才显示按钮；按钮浮在一条固定的空白条里，出现和消失都不会挪动对话。
- **每条回复的每种语言只翻一次。** 译文按语言缓存，换会话也还在。
- **可以提前翻好（可选）。** 设了主要语言后，每轮结束时，不是主要语言的回复会在后台先翻好。再打开 `autoExpand`，译文会自己展开。
- **直接用你的语言读（可选）。** 打开 `replaceOriginal` 后，译文不再显示在原文下面，而是直接显示在原文的位置上，每条回复一次只显示一种语言。点 **原文** 可以换回原文。再设了主要语言的话，每轮结束时，不是主要语言的回复会自动翻成主要语言并替换原文，不用点任何按钮。替换进去的译文最后一行末尾带一个小标记，比如 *（翻译自英语）*，一眼就能和 Claude 直接写的区分开。
- **翻译 Claude 写的全部内容（可选）。** 打开 `translateAll` 后，Claude 工作过程中、工具调用之间写的说明也会翻译。说明没有自己的按钮：这一轮最终回复下面的按钮管整轮，连说明一起；输入框上方那一行管最近几轮。
- **一次处理最近的回复。** 输入框上方有一行同样的按钮，管最近几条最终回复（默认 10 条）：点一下就把它们全部换成某种语言，或者全部换回原文。打 ✓ 的是它们都在用的语言；不一致时都不打。没有哪条能换成的语言不给按钮，比如这几条全是中文时，就没有「简体中文」。只处理这几条，所以对话再长，费用也不会变多。
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

这个设置对之后新开的会话生效，而且所有会话都会加载。打开 watch 后，文件一改，正在运行的会话就会重新加载这个 mod。多个文件夹用 `;` 分隔。如果你也从 marketplace 装了这个 mod，先把那一份停用（`claude plugin disable reply-translate@reply-translate`），免得加载两份。

## 配置

选项写在 `~/.claude/settings.json` 的 `pluginConfigs` 下，键是插件的 id：从 marketplace 安装的是 `reply-translate@reply-translate`，从文件夹加载的是 `reply-translate`。没写的选项用默认值。改完后新开一个会话生效。

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
      "model": "haiku"
    }
  }
}
```

| 选项 | 默认值 | 作用 |
| --- | --- | --- |
| `languages` | `auto` | 要翻译成的语言，逗号分隔。可以写语言标签（`zh-CN`、`zh-TW`、`en`、`ja`），也可以写名字（比如 `Japanese`）。每种语言一个按钮，按这个顺序排。`auto` 表示按钮文字的语言，再加上英语。 |
| `primaryLanguage` | 空（关闭） | 你自己的语言。每轮结束时，如果最终回复是别的语言，就在后台先翻成它，点按钮时马上显示。它也总排在目标语言第一位。 |
| `autoExpand` | `false` | 需要先设主要语言。打开后，后台翻好的译文会自己展开，翻译时显示进度条。 |
| `replaceOriginal` | `false` | 打开后，不管翻成哪种语言，译文都显示在原文的位置上，而不是原文下面，每条回复一次只显示一种语言。点 **原文** 换回原文。设了主要语言时，翻成主要语言的译文还会在每轮结束时自动生成并显示，不用点按钮；和 `autoExpand` 同时打开时以它为准。替换进去的译文最后一行末尾带一个标记，比如 *（翻译自英语）*，用界面语言写；最后是代码块、表格或标题时，标记单独占一行。 |
| `uiLanguage` | `auto` | 按钮文字的语言。`auto` 跟随 Claude Code 的 `language` 设置，没设就跟随系统语言；也可以直接写标签，比如 `zh-CN`。 |
| `skipPrimaryReplies` | `false` | 需要先设主要语言。打开后，本来就是主要语言的回复保持原样：不放按钮，也不留空位。已经展开了译文的回复照常显示译文。 |
| `alwaysShowButtons` | `true` | `true`：按钮一直显示。`false`：在桌面端，鼠标在回复上时才显示按钮。 |
| `translateAll` | `false` | 打开后，Claude 工具调用之间写的说明也会翻译。说明没有按钮：它这一轮最终回复下面的按钮，把整轮换成同一种语言，点 **原文** 整轮换回原文。最终回复是主要语言、但说明不是时，最终回复照样有按钮。说明的译文和回复一样显示：开着 `replaceOriginal` 时在原位，否则在说明下面。设了主要语言时，每段说明在它后面的工具调用开始时就翻译，不用等这一轮结束。 |
| `controlRange` | `10` | 输入框上方那一行按钮处理最近几条最终回复。点某种语言，每条都换成这种语言，和它自己的按钮一样：以前翻过的不再调用模型，没翻过的每条一次调用，本来就是这种语言的显示原文。点 **原文** 全部换回原文。`0` 表示不显示这一行。 |
| `model` | `haiku` | 用来翻译的模型，写别名或完整的模型 id。 |

也可以在命令行里设置。每个值都要写成字符串：

```
echo '{"languages":"zh-CN, en","primaryLanguage":"zh-CN","autoExpand":"true"}' | claude plugin configure reply-translate@reply-translate --values-stdin
```

只运行 `claude plugin configure reply-translate@reply-translate`，会列出所有选项，以及哪些已经设置。在终端版里，`/plugin configure` 和 `/config` 也会列出这些选项。

## 费用

翻译走的是你会话自己的模型客户端和凭据。用 Claude 订阅登录时，算在 plan 的用量里；用 API key 时，按 API 计费。每次调用都会显示在 `/cost` 里。设了主要语言后，每条非主要语言的最终回复都会多一次调用，不管你最后看不看。在输入框上方点某种语言时，最近几条回复里还没有这种译文的，每条一次调用，最多 `controlRange` 次。打开 `translateAll` 并设了主要语言时，Claude 写的每段非主要语言的说明也各算一次调用。

## 工作原理

- mod 读取会话的对话记录来找出最终回复：不调用任何工具的那次模型响应里的文字。它记下这些文字的指纹，只有这些回复才有按钮。一条由几个文本块组成的回复，只在最后一块下面放一组按钮，翻译时整条回复一起翻。
- 按钮是这样加上去的：把引擎对每条最终回复的绘制包一层（`AssistantMessage` 上的 `ui.render`）。存储的消息本身不会被改动。
- 每次翻译是一次 `$.model.complete` 调用，没有历史，也不带工具。回复用 `<reply>` 标记包起来，让模型把它当数据读。模型把译文写在 `<translation>` 标记里，标记外面写的东西（比如对原文的说明）一律丢掉。交回来的如果还是原文的语言，就再问一次；还是这样，就显示翻译失败，不当成译文显示。
- 译文存在会话状态里，也存在 mod 自己的存储里，换会话也保留。存储上限约 2 MB，超出时先删最旧的。

## 已知限制

- 回复语言只认得出中文、日文、韩文、英文。其他语言的回复，所有目标语言都会给出。
- 关掉 `alwaysShowButtons` 后，每条最终回复下面都留着一条约两行高的空白放按钮，按钮隐藏时也占着。
- 通过 Remote Control 查看的会话不显示按钮。
- 打开 `translateAll` 后，模型写成 thinking、桌面端当正文显示的说明保持原样：这些是桌面端自己画的，mod 管不到。只有写成普通文本的说明会翻译。

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
