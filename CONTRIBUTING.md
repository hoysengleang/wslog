# Contributing to wslog

Thanks for helping! Small, focused pull requests are easiest to review.

## Setup

Fork the repository on GitHub, then:

```bash
git clone https://github.com/<your-username>/wslog && cd wslog
npm install
npm run dev
```

`npm run dev` starts the server on port 4000 in demo mode and the Vite dashboard on http://localhost:5173 with hot reload.

## Before you open a pull request

```bash
npm run check      # typecheck, lint, unit tests
npm run test:e2e   # real browser against a real wslog (first time: npx playwright install chromium)
```

- Changes to the proxy, recorder, or storage need tests in `test/`.
- Changes you can see in the dashboard need an end-to-end test in `e2e/`. Each test gets its own wslog and a misbehaving upstream server (`e2e/fixtures.ts`), and any browser console error fails it.
- Wire-format changes go in `src/shared/protocol.ts` first.
- Keep runtime dependencies minimal: wslog ships to users via `npx`, so every dependency is download time.

Read [docs/architecture.md](docs/architecture.md) for how the pieces fit together.

## Good first issues

Look for the `good first issue` label. If you want to work on something bigger, open an issue first so we can agree on the approach.

## Security issues

Please do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
