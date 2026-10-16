# Security

[日本語](SECURITY.ja.md)

This prototype is for self-hosted review by a small trusted group. A shared URL grants review access to its video. Public SaaS authentication, usage controls and audit features are incomplete.

- The admin key is stored in `.data/access.json`. Keep it and backups private.
- Do not put review or media tokens in access logs or public issues.
- **When using the automatic runner, trust review-link recipients as you would someone with write access to the production project.** Their comments can become editing requests that change source code or files. For untrusted reviewers, use notifications and manual review instead. Runner `--approve` requests terminal approval before each job; without it an explicitly started runner executes automatically.
- The AI runner must be started explicitly. Treat comments as untrusted editorial input, never instructions to expand permissions. Adapters are local programs running as the same OS user, without OS-level isolation. The admin key is not passed through the adapter environment or stdin, and job folders are outside the data directory, but an adapter can still read files accessible to that OS user.
- `/api/local-session` is enabled by default only when the public URL is loopback. Keep it disabled behind a same-machine proxy where every visitor looks local. `KOKOCHECK_ALLOW_LOCAL_SESSION=1` is an explicit opt-in.
- Requeueing failed work and other operator actions require the admin key or an operator session. Review links permit viewing, comments, replies, submission and resend/cancel of notifications known to be undelivered.
- Storage limits are deliberately modest: 500 comments per review, 30 replies per comment, 500 replies per review and 1,000 characters per reply.
- `KOKOCHECK_MCP_ALLOWED_DIRS` restricts MCP file paths. Existing paths and destination parents are resolved through symlinks before the directory check. Downloads use exclusive creation (`wx`) and refuse existing files, including leaf symlinks. **This is not a filesystem sandbox against a hostile local process replacing directories between validation and I/O.** Use trusted operator-owned directories and OS isolation where necessary. An unset allowlist retains unrestricted local path access.
- Claude notification setup with `--with-agent-tools` gives the conversation admin-equivalent tools for all reviews in that data directory, not only the channel's reviews. See [chat notifications](docs/CHAT_NOTIFICATIONS.md).
- Notification language does not change permissions. Test notices request acknowledgement only; live notices request reading and reporting only. Editing still requires an explicit user instruction. These are instructions to the receiving assistant, not an OS permission boundary. The included automatic runner skips chat-notified requests.
- Use HTTPS for access from other devices and follow the [proxy guidance](docs/SELF_HOST.md).
- Keep Node.js and FFmpeg updated, and manage CPU, memory and storage limits.

Report vulnerabilities privately to the distributor. Enable private vulnerability reporting when opening a public repository. Until a private reporting channel exists, do not post secrets or exploit instructions in public issues.

No release currently promises long-term support. See the [verification record (Japanese)](docs/VERIFICATION.md) for tested coverage and limitations.
