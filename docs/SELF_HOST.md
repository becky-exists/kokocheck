# Self-host

[日本語](SELF_HOST.ja.md)

## Native installation

Install Node.js 24.14 or newer and FFmpeg/ffprobe. From the repository root:

```sh
npm ci
npm run doctor
npm run build
npm start
```

The default address is localhost:4391. If changing `PORT`, also set `KOKOCHECK_PUBLIC_URL` to match.

Persist `KOKOCHECK_DATA_DIR` (default `.data/`). SQLite is designed for one Node server, not shared operation by multiple server instances. The generated admin key is in `access.json`.

With a loopback public URL, the browser on the host can sign in automatically. For a non-loopback public URL, automatic login is disabled by default and the admin key is required. This also applies to reverse proxies and Docker. Opt into `KOKOCHECK_ALLOW_LOCAL_SESSION=1` only if everyone who appears local can be trusted.

The interface follows the browser language, with a persistent JP / EN switch. This is independent from notification bindings: set `lang: "ja"` explicitly to retain Japanese notifications after upgrading. New or unspecified bindings use English. See [chat notifications](CHAT_NOTIFICATIONS.md).

## Docker Compose

```sh
docker compose up --build -d
```

The host binds only to 127.0.0.1:4391 and persists data in a named volume. The container runs as the `node` user and includes no AI CLI or credentials. Run a production runner separately on the host.

To retrieve your admin key, run this on your own local terminal. Do not share its output:

```sh
docker compose exec review node -e 'console.log(JSON.parse(require("fs").readFileSync("/data/access.json","utf8")).adminToken)'
```

The existing verification record from 2026-10-16 covers Linux arm64 container build/startup, non-root execution, generated MP4 import, pin snapshots and persistence after restart. amd64 is unverified. Native installation/build/startup were also checked from a fresh source archive. These historical checks are not claims that every later change was rerun in Docker.

## Sharing with another device

- Set `KOKOCHECK_PUBLIC_URL` to a reachable HTTPS URL and restart.
- Terminate TLS at a trusted proxy. Preserve the public Host/Origin and set forwarding headers correctly. Do not rewrite requests as localhost to obtain an operator session on behalf of visitors.
- Review links are access credentials. With an automatic runner, trust recipients as you would someone with write access to the production directory. See [Security](../SECURITY.md). Media URLs also carry a query token; exclude queries from access logs.
- Reject requests larger than 512 MB at the proxy and allow sufficient transfer time for large videos.

This version targets a small trusted group. Link expiry/revocation, per-person roles, storage quotas, public-internet rate limiting, audit logs and automatic backups are not implemented.

Uploaded videos are read by FFmpeg. Update FFmpeg and configure OS/container CPU, memory and storage limits. The interface does not fetch arbitrary remote URLs.

## Distribution

Keep the application's MIT license and dependency licenses. Exclude private `.data/` from source archives and Docker build contexts. `npm run release:source` creates an archive, checksum and file manifest with lockfile and exclusion rules. The Docker image uses the distribution's FFmpeg build; check its specific redistribution conditions.
