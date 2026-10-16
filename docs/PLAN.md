# KokoCheck v0.1 — approved product scope

Name: KokoCheck (formerly Frame Review).

The reviewer opens an already populated URL, watches, annotates time/range and screen position, submits a batch, and reviews the resulting revision. There is no reviewer-facing video editor. Source-backed video is primary; standalone MP4 is supported for review and feasible downstream processing.

## Screens

- Library (local owner): upload MP4, see reviews, copy review URL.
- Review: player, timeline, version selector, comment sidebar/bottom sheet, fixed-frame pin, interval, automatic snapshot, submit batch.
- Compare: a selected comment's previous frame/segment and mapped revised segment. Desktop side by side, mobile A/B. Agent-reported changes are labeled as reports, not automatically verified facts. No correspondence is shown as unknown.

## Model

Project owns immutable Versions, Comments and Requests. Comments reference one version, a precise second value, optional end time and normalized image coordinates (excluding letterbox). Requests freeze deep copies of selected draft comments. Later notes belong to another batch. Only one active request per project; atomic claim/lease fences duplicate workers. Expired work needs explicit requeue; no automatic replay of edits. Publishing requires current lease, expected base version and a report for every requested comment. Reviewer alone accepts changes. Reopening creates a new comment while preserving the original evidence.

## Integration

HTTP API is the shared boundary. Stdio MCP: register video, list/claim requests, renew lease, retrieve pinned evidence, publish revision, report failure. A local opt-in runner can call a configured adapter executable. Core never evaluates comments as shell commands and never launches Codex/Claude by default. Runner input is a JSON snapshot on stdin, output is a revision manifest, credentials stay in runner process. Adapters own access to source material and rendering. Authentication separates reviewer capabilities from operator credentials.

## Delivery

1. Local persistent review loop with MP4/source registration.
2. Request queue, common MCP, opt-in adapter runner, revision publication.
3. Diff navigation, changed segments playback, docs, self-host packaging, tests.

MVP comparison is visual/audio A/B plus explicit mappings; pixel detection, semantic video diff and automatic scene correspondence are deferred. Pins do not track moving objects. Unsupported video codecs are rejected with an actionable message; MP4/H.264 is the first browser-compatible target.

## Verification

Use generated fixtures with no third-party/private media. Exercise both source and MP4 paths; durable storage/restart; pin coordinates at desktop/mobile sizes; range capture; immutable requests; exclusive claims; stale lease denial; per-project authorization; cross-version mapping; blocked results; accept/reopen; MCP client/server round trip. Browser screenshots and interaction checks at desktop and phone sizes. Paid agent runs, real iPhone Safari and public hosting are separate integration coverage.
