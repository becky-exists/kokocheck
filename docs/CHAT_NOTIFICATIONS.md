# Notify the original production conversation

[日本語](CHAT_NOTIFICATIONS.ja.md)

KokoCheck saves the request first, then notifies the conversation selected by the local operator. Codex uses `codex queue`; Claude Code uses Channels. This code does not start another `exec` session or call a paid AI API. The receiving assistant's response still uses your account's allowance. Delivery acceptance is not proof of receipt or the start of editing.

## Language and editing boundaries

Set `lang: "en"` or `lang: "ja"` on each review binding. The default is **English**, including older bindings with no language field. To keep an existing Japanese workflow, add `"lang": "ja"` before running the updated build. The UI switch is independent and cannot change the production destination or notification language.

Claude named channels can also specify `lang` as the channel default; a binding's value overrides it. `setup:claude -- --lang ja` creates a Japanese binding; without the flag it creates an English binding. Existing entries are preserved.

Both languages retain the same boundaries:

| Mode | What the receiver is asked to do |
|---|---|
| `testOnly: true` | Acknowledge receipt only. No video edits, file changes or additional notifications. |
| `testOnly: false` | Read the saved request and comments, then report them in the same conversation. Do not start video editing or file changes; wait for explicit user instruction. |

Generated direction guidance follows the receiver's language when frozen comments are read through the channel or claimed through the API/MCP. Stored comments, pins, times, selected preset IDs and user-supplied caption text are preserved. Direction examples express editorial intent; they do not grant permission to execute it. No translation service or AI translation API is used.

## Codex setup

1. Use a Codex CLI signed in as the same user. Check `codex queue --help` for support.
2. Identify the intended production conversation's thread ID and the KokoCheck project ID.
3. Create `notify-codex.json` in the data directory, editable only by the operator. `.data/` is excluded from distribution.
4. The next event reads the file; adding a binding does not require a restart.

```json
{
  "version": 1,
  "executable": "/absolute/path/to/codex",
  "bindings": {
    "11111111-1111-4111-8111-111111111111": {
      "threadId": "22222222-2222-4222-8222-222222222222",
      "testOnly": true,
      "lang": "en"
    }
  }
}
```

Replace example UUIDs with real IDs. `executable` must be an absolute path to a trusted CLI. An npm wrapper needs Node on the service's PATH; a native Codex executable is also supported.

Begin with an isolated review and `testOnly: true`. Confirm an acknowledgement in the original conversation before setting a real review to `false`. The original conversation must have access to the saved data or authenticated API/MCP. Notifications contain project/request IDs and a review URL without its share token, never comments or credentials.

The app or CLI hosting the conversation must be running. A busy Codex conversation receives queued content on a subsequent turn. Delivery after the app/CLI has exited, and Windows delivery, are unverified. Docker containers do not contain the host's Codex CLI and conversation queue; this connection is intended for a host-native KokoCheck server.

## Persistence, resend and cancel

- Requests and frozen comment snapshots are saved to SQLite before notification.
- Repeated submissions while a request is active return 409. An HTTP disconnect does not create a second request.
- `sending` excludes another resend or cancellation during delivery.
- `queued` means the CLI or MCP transport accepted the message, not that a person or assistant read it.
- Failure to start the CLI or a disconnected receiver is `failed`. Timeouts, ambiguous receipts and a server restart during delivery become `uncertain`; there is no automatic retry.
- **Notify again** and **Cancel request** appear only for `failed`, where delivery is known not to have happened. Cancellation keeps the request record and returns live comments to drafts.
- `uncertain` is not offered for resend/cancel, to avoid duplicate delivery. The operator should inspect the saved request and original conversation.
- The included automatic runner skips every request with a chat notification, including failed notifications. After explicit approval, the original conversation can claim work through existing MCP/API tools.
- Removing a binding stops future notifications; it does not retract an already accepted message. Projects without bindings retain ordinary agent-request behavior.

## Claude Code setup

The connection uses Claude Code's Channels in a running interactive conversation. It is not a message sender for ordinary Claude web chats. The existing integration targets claude.ai subscription authentication; consult [Channels](https://code.claude.com/docs/en/channels) and its [reference](https://code.claude.com/docs/en/channels-reference) for current account and client requirements.

Build first, then create an isolated test review and configure its project ID:

```sh
npm run build
npm run setup:claude -- --project REVIEW_UUID --data-dir .data --port 4393 --lang en
```

This creates `.data/notify-claude.json` and `.data/claude-channel.mcp.json`. A random shared secret stays in local configuration. It does not change global Claude settings or start a session. Default mode is acknowledgement-only.

```json
{
  "version": 1,
  "channels": {
    "review": { "port": 4393, "token": "REPLACE_WITH_64_RANDOM_HEX_CHARACTERS", "lang": "en" }
  },
  "bindings": {
    "REVIEW_UUID": { "channel": "review", "testOnly": true, "lang": "en" }
  }
}
```

Use the command printed by setup from the production project directory. Resume the intended conversation; do not run two processes for the same session at once.

```sh
claude --resume --mcp-config /absolute/path/to/.data/claude-channel.mcp.json --dangerously-load-development-channels server:frame-review-channel
```

This custom development channel requires the client channel approval prompt. The flag enables the channel, not permission bypass for editing tools. `--dangerously-skip-permissions` is not needed. Organization settings may also need to enable Channels. Use an interactive conversation: the development channel flag is not supported in non-interactive `-p` mode by the tested integration.

Add a comment to the isolated review and choose **Request changes**, then **Save & notify**. Check for the acknowledgement in Claude. For a new real review, add `--live`; this changes the request to read/report-only, not automatic editing.

### Add reviews without reconnecting

One named channel (one port and one conversation) can serve several reviews:

```sh
npm run setup:claude -- --project ANOTHER_REVIEW_UUID --data-dir .data --channel review --live --lang en
```

- Existing entries, including legacy per-review `port`/`token` bindings, are preserved. Trying to bind the same review again is refused.
- Both KokoCheck and the receiver reload settings on the next event. The conversation need not reconnect when another review is added.
- A different channel (`--channel other --port 4394`) gets `claude-channel-other.mcp.json` and needs a separate conversation connection.
- Token rotation takes effect on the next event; old tokens are rejected. Changing the listening port requires a receiver restart.
- Configuring one review for both Codex and Claude is refused at startup or at the next submission if changed during runtime.
- Never expose the channel port through a VPN, reverse proxy or the internet. It binds to fixed loopback and is for machine-to-machine requests only.

### Optional editing tools

By default the channel offers only `frame_read_notified_request`, a read-only tool. For a new binding, `--with-agent-tools` adds the existing editing MCP server to its opt-in configuration:

```sh
npm run setup:claude -- --project REVIEW_UUID --data-dir .data --with-agent-tools --lang en
```

**This grants admin-equivalent access to the conversation.** Those tools can claim, renew/release work, download videos and publish revisions for every review in that data directory, not just the channel's reviews. Use a trusted conversation and an appropriately isolated data directory. Restrict local file paths with `KOKOCHECK_MCP_ALLOWED_DIRS`; see [Security](../SECURITY.md) and [Integration](INTEGRATION.md). Adding tools does not change the notification's read/report-only instruction.

### Receiver behavior and limitations

- After saving, KokoCheck sends only project ID, request ID and its public URL to the loopback endpoint.
- The endpoint checks Host/browser headers, reloads configuration and authenticates the token **before parsing JSON**. It accepts only bound reviews and fixed message fields, not arbitrary prompts.
- Public URLs allow HTTP(S) origin and an optional path, but reject credentials, query strings and fragments.
- `frame_read_notified_request` reads only an ID previously notified by that process. It rechecks current bindings, so removal takes effect on reads too. Reading does not claim a lease or modify videos.
- The read-only channel has no editing admin key. Editing requires explicit user instruction and an existing production tool connection, such as the optional MCP server above.
- `queued` means a transport write completed. Channels do not provide automatic receipt acknowledgement; a disabled channel can still discard the event. Verify with the assistant's reply.
- Unavailable receiver: `failed`. Timeout or unclear result: `uncertain`. Requests remain saved; there is no fallback assistant launch or automatic resend.
- Repeated IDs are deduplicated within the receiver process, including ambiguous send failures. There is no cross-restart channel deduplication or read receipt.

To disconnect, resume Claude without the channel and remove its binding from `notify-claude.json`. Existing requests remain saved. Keep configuration private with the data directory.

The tested target is same-machine Node.js 24 and Claude Code CLI. Real Windows/Android devices and cross-container notification delivery remain unverified. Reviewing phones do not need channel configuration.
