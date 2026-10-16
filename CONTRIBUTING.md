# Contributing

[日本語](CONTRIBUTING.ja.md)

Thanks for helping. KokoCheck needs Node.js 24.14 or newer and FFmpeg / ffprobe. The demo and tests also need Python 3 and Pillow.

```sh
npm ci
npm run doctor -- --demo
npm run build
npm test
npm run security-check
```

Start the dev server with `npm run dev`. To keep it apart from real work, use `KOKOCHECK_DATA_DIR=.test-data/manual PORT=4392 KOKOCHECK_PUBLIC_URL=http://localhost:4392 npm run dev`.

Please keep to these design rules:

- Fill surfaces with the single IW teal only. There is at most one filled button on a screen at a time; orange and red are for text and icons only.
- Put what people read at the top and what they operate at the bottom. Screen labels are verbs and nouns only, with no half-width-space phrase breaks. Never rewrite the user's own words.
- Check at phone widths 390px and 320px, at short heights and on desktop. Software keyboards and finger touch need a separate check on a real device.
- Never attach videos, share keys, admin keys, `.data/` or `.env` to commits or issues. For reproductions use the self-made material from `scripts/fixture.ts`.
- Direction examples are intent drawn over your own frame; no image is stored or sent. Do not bundle third-party videos or templates.
- A producer's report that a change was made is not the same as a person's OK. Make sure neither automated tests nor an agent approves in their place.
- In your pull request, describe the experience you changed, how you verified it and what you did not verify.

A source archive is made with `npm run release:source`. It sends and publishes nothing. For the pre-release checks see [RELEASE.md](docs/RELEASE.md) (Japanese).
