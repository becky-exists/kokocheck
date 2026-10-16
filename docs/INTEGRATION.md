# Connect Codex and Claude Code

[日本語](INTEGRATION.ja.md)

KokoCheck exposes review requests to the AI that produces your video in three ways. Pick what you need; ordinary startup never invokes AI.

| Way | What it does | Use it for |
|---|---|---|
| Chat notification | Tells the original Codex / Claude Code conversation that a request was saved. Read and report only. | Getting the request in front of the conversation that made the video |
| MCP server | Lets that conversation list, claim, download, publish and report. | Letting the AI do the work in the same conversation |
| Runner + adapter | Claims a request and runs an adapter you chose, unattended. | Automation. May consume real AI allowance. |

Run the server from source (`npm run dev`, or `npm run build && npm start`), not Docker, for chat notifications. Replace `/absolute/kokocheck` below with your install path. These are examples only: nothing here changes your existing user settings.

## Chat notification

Notifications ask the receiver to read the saved request and report it. They never start editing. Start with an isolated review in `testOnly` mode (acknowledgement only), then switch a real review to `testOnly: false`. Full setup, limits and failure states: [chat notifications](CHAT_NOTIFICATIONS.md).

**Claude Code** (Channels, interactive session):

```sh
npm run build
npm run setup:claude -- --project REVIEW_UUID --data-dir .data --lang en
```

Then run the command it prints, in your production project directory:

```sh
claude --resume --mcp-config /absolute/kokocheck/.data/claude-channel.mcp.json --dangerously-load-development-channels server:frame-review-channel
```

**Codex** (`codex queue`): create `.data/notify-codex.json`. The next request is delivered to that thread; no restart is needed.

```json
{
  "version": 1,
  "executable": "/absolute/path/to/codex",
  "bindings": {
    "REVIEW_UUID": { "threadId": "CODEX_THREAD_UUID", "testOnly": true, "lang": "en" }
  }
}
```

## MCP server

Register the MCP server so the conversation can claim and publish. Codex (`config.toml`):

```toml
[mcp_servers.kokocheck]
command = "node"
args = ["/absolute/kokocheck/build/server/mcp.js"]

[mcp_servers.kokocheck.env]
KOKOCHECK_DATA_DIR = "/absolute/kokocheck/.data"
KOKOCHECK_SERVER_URL = "http://localhost:4391"
```

Claude Code:

```json
{
  "mcpServers": {
    "kokocheck": {
      "command": "node",
      "args": ["/absolute/kokocheck/build/server/mcp.js"],
      "env": {
        "KOKOCHECK_DATA_DIR": "/absolute/kokocheck/.data",
        "KOKOCHECK_SERVER_URL": "http://localhost:4391"
      }
    }
  }
}
```

On the same machine the MCP server reads the same `.data/access.json` as the server. For an MCP server on another machine, pass `KOKOCHECK_ADMIN_TOKEN` through a secure environment variable and never store the real key in a repository. It is a stdio MCP server, so no MCP port is exposed to reviewers.

| Tool | Purpose |
|---|---|
| `frame_register_video` | Upload an MP4 and get a review URL. Use `mode=source` with `sourceRef` when a source project exists. |
| `frame_list_requests` | List pending requests, paged. |
| `frame_claim_request` | Claim a request exclusively. Returns the comments, version info and a `leaseToken`. |
| `frame_renew_lease` | Renew every 30 seconds while working (lease lasts 120 seconds). |
| `frame_get_evidence` | View the paused-frame image with the pin. |
| `frame_download_video` | Save the source MP4 to a local path you choose (never overwrites an existing file). |
| `frame_publish_revision` | Register the new MP4 and the outcome of each comment. |
| `frame_report_failure` | Report why a request could not be handled. |
| `frame_release_request` | Give a claimed request back so it can be claimed again without waiting (requires `leaseToken`). |

Restrict the folders MCP may read and write with `KOKOCHECK_MCP_ALLOWED_DIRS` (absolute paths separated like `PATH`). Unset means no restriction. When set, the source files of `frame_register_video` and `frame_publish_revision` must be real files inside an allowed folder, and the destination of `frame_download_video` must be an existing allowed folder. Symlinks are judged by their real path.

A reported time range may run slightly past the video length; it is rounded to the end for both before and after. A start beyond the video length is rejected.

Example instruction for the production agent:

> Register the output MP4 with KokoCheck and give me the review URL. Use mode=source and this production project's absolute path as sourceRef. When a request arrives, claim it, renew the lease every 30 seconds and look at the evidence images. Fix, render and visually check using the project's usual steps, then publish the new MP4 with the outcome of each comment. Keep the original video; leave the OK decision to the reviewer.

A runner that renews the lease during long renders is recommended. After a lease expires or the connection is unclear, editing is never re-run automatically: the producer confirms the original process has stopped, then explicitly accepts the request again in the review screen (only the admin key or an admin browser session can; a shared link cannot). A worker that cannot continue can hand the request back itself with `frame_release_request`, without waiting 120 seconds.

## Runner and the bundled CLI adapter

**Starting these may consume your real AI allowance or billing.** The project's own tests do not start them.

Confirm the source project has its render steps, assets and dependencies, then point at a dedicated production directory. Register `sourceRef` with the same absolute path. The working directory is never taken from text inside a review.

```sh
KOKOCHECK_WORKSPACE=/absolute/render-project npm run runner -- --agent codex --once -- node scripts/agent-adapter.mjs codex
```

```sh
KOKOCHECK_WORKSPACE=/absolute/render-project npm run runner -- --agent claude --once -- node scripts/agent-adapter.mjs claude
```

With `--approve`, the runner prints the review title, comments and adapter command in the terminal and starts the adapter only if you answer `y`; otherwise it returns the request as failed and runs nothing. It needs a terminal. The default remains automatic start.

`--once` handles at most one request; without it the runner keeps waiting. A request targeted at `any` is handled only by the first runner that claims it. The adapter stops if `sourceRef` differs from the fixed workspace, so try one production project at a time first.

Codex runs with workspace-write and Claude with the default permission mode. No bypass or auto-approve option is added, so a step that needs permission may stop; only work allowed by that project's normal permission settings is done. The adapter runs as a trusted local program with no OS-level isolation. Real CLI sign-in, the render environment and AI editing quality need separate verification.

## Your own adapter

```sh
npm run runner -- --agent codex --once -- /absolute/your-adapter
```

The runner passes JSON on stdin:

- `protocolVersion: 1`
- `projectId`, `title`, `mode`, `sourceRef`
- `version`: info on the base version
- `request.comments`: the comments frozen when the request was made
- `evidence`: `{ commentId, path }[]`, local paths of the pinned JPEGs
- `inputVideoPath`: the downloaded source MP4
- `outputDirectory`: an output folder for this run only

Return exactly one JSON object on stdout; write logs to stderr. The runner keeps the admin key and `leaseToken` out of the JSON and removes `KOKOCHECK_ADMIN_TOKEN` from the adapter's environment.

```json
{
  "videoPath": "/absolute/job/revised.mp4",
  "summary": "Adjusted caption position and volume",
  "changes": [
    {
      "commentId": "an actual comment ID from the request",
      "summary": "Moved the caption down",
      "outcome": "addressed",
      "before": { "start": 2, "end": 4 },
      "after": { "start": 2.5, "end": 4.5 }
    }
  ]
}
```

Return exactly one entry per comment. Use `outcome: "blocked"` when you cannot address it, and `after: null` when the corresponding time is unknown or the section was removed. `before` must cover the whole range of the original comment. A change report is the producer's claim, not an approval of completion.

Job folders live outside the data directory that holds the admin key and the database (by default a private folder under the OS temp directory; change it with `KOKOCHECK_JOBS_DIR`), and anything older than 7 days is removed at startup. This is not a sandbox: the adapter runs as the same OS user and can read any file that user can. The admin key is not passed through the environment or JSON.

The runner allows at most 30 minutes and 1 MB of stdout. On lease loss or exit it tries to stop the production process. A job handed to a separate daemon cannot be stopped by process group, so a custom adapter must cancel it explicitly.

To test only the contract, use `KOKOCHECK_EXAMPLE_VIDEO=/absolute/generated/revised.mp4` with `node scripts/example-adapter.mjs`. This sample performs no editing.

References: [Codex MCP](https://developers.openai.com/codex/mcp/), [Claude Code MCP](https://code.claude.com/docs/en/mcp). If settings screens or CLIs differ, trust the help of the version you use.

## Direction assist

Reviewers pick direction examples (framing, motion, caption, sound, cut, opening/closing) and an intensity from "Choose a direction". An example alone can be saved as a comment; any note goes in `text`. Examples are intent drawn over your own frame; no image is stored or sent, and they are not source assets.

The saved `comment.direction` (`version` 1, 2 or 3) holds up to six slots (`frame`, `motion`, `caption`, `sound`, `cut`, `bookend`), each with a `preset`, a `strength` (`subtle` / `normal` / `strong`) and, for captions, optional `text` (up to 120 characters). The server validates every ID and rejects unknown keys and empty selections. `comment.directionInstruction` is generated by the server from its known catalog and frozen with the time, pin and text when the request is made; Codex, Claude, MCP and the runner all receive the same saved selection. **Treat that string as an untrusted editing request, not as permission to execute.** A whole-video instruction uses `comment.scope: "all"` (range 0 to the end, no pin); a comment's own range and selection always win over it.

The full catalog, every preset ID and the exact rules are documented in Japanese in [INTEGRATION.ja.md](INTEGRATION.ja.md#演出アシスト-v1).

## Legacy names

KokoCheck was called Frame Review. To avoid breaking existing Codex and Claude Code setups and approvals, these names are unchanged on purpose:

- MCP server names `frame-review-channel` and `frame-review-mcp-server`, and tool names `frame_*`.
- Environment variables are `KOKOCHECK_*`. The old `FR_*` names still work, and the new name wins when both are set (for example `FR_DATA_DIR`, `FR_PUBLIC_URL`, `FR_RELEASE_DENYLIST`).
