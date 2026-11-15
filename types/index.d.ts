// One final reply's translations, keyed by the reply's fingerprint.
export type Reply = {
  // running: a translation the person asked for is under way; done:
  // texts[language] is shown, or hidden; error: the last try into `language`
  // failed. Absent: nothing was asked yet, though `texts` may hold a
  // translation made ahead of time.
  status?: 'running' | 'done' | 'error'
  // The target the reply is on: its tag (`zh-Hans`, `en`) or a name as written.
  language?: string
  isHidden: boolean
  // Every translation made so far, by target, so going back costs no call.
  texts: Record<string, string>
  // The reason of the last failure (`api-error`, `empty-reply`, `aborted`).
  error?: string
  // The target a translation ahead of time is running for.
  prefetching?: string
}

declare module 'claude-code' {
  interface PluginState {
    'reply-translate': {
      finals: Shaped<string[]>
      // The language the buttons are drawn in: a key of the strings table.
      uiLocale: string
      replies: StateFamily<Reply>
    }
  }
}
