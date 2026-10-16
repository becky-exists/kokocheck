<h1 align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/brand/kokocheck-lockup-dark.svg"/><img src="docs/brand/kokocheck-lockup-light.svg" alt="KokoCheck" width="360"/></picture></h1>

[日本語](README.ja.md)

Watch, comment, check. Review video revisions in one shared link.

> Published at [github.com/becky-exists/kokocheck](https://github.com/becky-exists/kokocheck). MIT License.

Upload a video → mark a time, range or pin → request changes → compare versions → approve.

**v0.1 / local-first prototype.** The browser is a review tool, with no video editor. Videos with an editable source project are the primary workflow; standalone MP4 review is also supported. Production-side Codex, Claude Code or your own adapter performs edits.

## Start

Requires Node.js 24.14 or newer and FFmpeg / ffprobe on PATH. The generated demo and automated media tests also need Python 3 and Pillow.

```sh
npm ci
npm run doctor
npm run dev
```

Open http://localhost:4391 and upload an MP4: H.264 video with AAC/MP3 audio or no audio, up to 512 MB and 2 hours. Convert other codecs first.

Run `npm run demo` in another terminal for a generated test film (timecode and ticks on black), before/after versions, pins and an audio-level change. It makes no external AI calls.

For a compiled build:

```sh
npm run build
npm start
```

Environment variables are named `KOKOCHECK_*` (see `.env.example`). The old `FR_*` names still work, and the new name wins when both are set. The MCP server names (`frame-review-channel`, `frame-review-mcp-server`) and tool names (`frame_*`) are unchanged on purpose, so existing Codex and Claude Code setups keep working.

SQLite, videos, snapshots and the admin key live in `.data/`. Reviews survive server restarts. Stop the server and runner before backing up the entire data directory.

## Review workflow

- A shared URL opens the uploaded video for review.
- Comments include times, ranges, a pin on a paused frame and an automatic snapshot.
- Direction assist combines 7 framing, 6 motion and 8 caption examples. Optional caption text, time, pin and notes travel with the feedback. Examples describe intent; they are not source assets.
- Reply, edit unsent comments and submit selected comments together.
- Version history, before/after segment playback and changed-only playback.
- Unsent → Requested → Awaiting review → OK. Follow-up comments retain the original history.
- Shared MCP tools, HTTP API and an opt-in runner for Codex and Claude Code.

**Languages:** The interface follows your browser preference on first use. A small JP / EN switch remembers your choice on that browser. Dates follow the selected locale. Titles, comments, replies and caption text are not translated. Notification language is configured separately for each production destination: `lang: "en" | "ja"`, default `en`. See [chat notifications](docs/CHAT_NOTIFICATIONS.md).

**Shared links grant review access.** When using an automatic editing runner, trust link recipients as you would someone with write access to the production project. See [Security](SECURITY.md). Limits: 500 comments per review, 30 replies per comment, 500 replies per review and 1,000 characters per reply.

Change comparisons use time mappings supplied by the producer. They are not automatic pixel or semantic diffs. Unknown correspondence stays unknown. Pins mark a paused frame; they do not track objects.

## Production connections

The [integration guide (Japanese)](docs/INTEGRATION.md) covers MCP and runner configuration. Ordinary startup does not invoke AI.

- MCP: register videos, claim/release work, read snapshots, download source videos and publish revisions.
- Runner: execute an explicitly selected adapter, with exclusive claims and lease renewal.
- `agent-adapter.mjs`: a minimal Codex/Claude CLI adapter in a fixed production directory. **Actual AI editing quality and integration with individual renderers remain unverified.** It stops if existing permissions are insufficient.
- `example-adapter.mjs`: returns a generated video for connection tests; it does not perform real editing.
- Original-chat notifications: Codex uses `codex queue`; Claude Code uses Channels. Notifications ask for acknowledgement or content review only. **They do not authorize editing.** See [setup and limits](docs/CHAT_NOTIFICATIONS.md).

## Self-hosting

See [Self-host](docs/SELF_HOST.md). Docker Compose is included. The default listens on localhost only. Sharing across devices needs a reachable host and HTTPS. This prototype does not include public SaaS operations.

## Structure and checks

| Directory | Contents |
|---|---|
| `src` | React interface and language selection |
| `server` | Express API, SQLite, FFmpeg, MCP and runner |
| `shared` | Types, time ranges, localization and direction presets |
| `scripts` | Generated demo, adapters and packaging |
| `tests` | State, HTTP, real media, notifications, localization, MCP and runner tests |

```sh
npm run build
npm test
npm run security-check
```

[Plan (Japanese)](docs/PLAN.md) / [Verification record (Japanese)](docs/VERIFICATION.md)

## Source distribution

Application code is MIT licensed. Dependencies and FFmpeg retain their own licenses. FFmpeg redistribution terms depend on the build you distribute. KokoCheck (formerly Frame Review) is the current name.

`npm run release:source` produces a standalone source archive and checksums, including the lockfile and exclusion rules. It excludes `.data/`, `.env`, client footage and credentials. See [release guide (Japanese)](docs/RELEASE.md). `package.json` is intentionally `private: true` to prevent accidental npm publication.

[Contributing (Japanese)](CONTRIBUTING.md) / [Security](SECURITY.md)
