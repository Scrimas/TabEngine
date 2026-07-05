# Contributing to TabEngine

Thanks for wanting to help out. This is a small, early-stage project, so contributions of any size are useful — bug reports, fixes, docs, or features.

## Getting set up

```bash
npm install        # installs deps, also copies alphaTab's runtime assets into public/
npm run tauri dev   # starts the real app: Vite + the Tauri window
```

See the README's [Building from source](README.md#building-from-source) section for platform notes.

## Before you open a PR

Run whichever of these apply to your change:

```bash
npm run check   # svelte-check — run this if you touched any .svelte or .ts file
npm run build   # tsc type-check + vite build
```

There's no test suite or linter configured, so these two checks (plus manual testings) are what stand in for CI locally.

If your change touches playback or rendering, test it against a real Guitar Pro file (GP3/4/5/GPX), not just the UI in isolation.

## Code conventions

- Path alias: use `$lib/*` for imports under `src/lib/*`.
- **Filesystem access** goes through Rust Tauri IPC commands (`src-tauri/src/commands.rs`). Don't use browser File APIs.
- **Songsterr HTTP calls** are implemented in Rust (`src-tauri/src/songsterr.rs`) and exposed as IPC commands, specifically to bypass CORS. Don't add `fetch()` calls to Songsterr from frontend code — add a Rust command instead.
- **alphaTab** is wrapped by the `AlphaTabManager` singleton (`src/lib/alphatab/`). Components should read from Svelte stores, not import alphaTab directly.
- Don't change the `esnext` / `chrome120` build target — it's intentional (avoids transpiling BigInt literals that alphaTab depends on).

## Commit style

This repo uses [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, e.g. `feat(ui): add tuning label overlay`, `fix(songsterr): handle 404 on tab fetch`.

Prefer splitting unrelated changes into separate commits (e.g. a docs fix and a feature) rather than bundling everything into one, even if they end up shipped together.

## Opening a PR

Fill out the PR template — description, what type of change it is, and how you tested it. Link any related issue.

## Reporting bugs / requesting features

Use the issue templates (bug report / feature request). For bugs, include your OS and steps to reproduce — that's usually the fastest way to get a fix.

## License

By contributing, you agree your changes are licensed under the project's [GPLv3 license](LICENSE).
