# Repository Guidelines

## Project Structure
- `src/App.jsx` — sole wiring point and the place to inject a domain (`agentDeps`, `buildSystem`, voice `extraTools`,
  `renderMessage`, `leftSlot`, `.workspace-main`). `src/hooks/` own state and expose handlers.
- `src/agent/` — Claude tool-use loop, client, registry, compaction, conversation store, system prompt + `skills/`.
  Never imports `src/tools/`.
- `src/voice/` — Gemini Live client, `run_prompt` declaration, instruction builder, audio capture/playback, PCM helpers.
- `src/tools/<source>/` — tool definitions/handlers per source; `sources.js` lists them. `example/` is the template.
  `javascript/` exposes `execute_javascript` (generated JS run in a throwaway Worker).
- `src/analysis/` — sandboxed JS execution: pre-flight token check, throwaway module Worker, timeout /
  input & output caps. Domain-agnostic; returns a `status` instead of throwing.
- `src/data/settings.js` — localStorage keys (prefix `voice-agent-shell.`) and defaults.
- `src/components/` — display & input only.
- `test/` — `node --test` for pure logic.

## Commands
`npm run dev` · `npm run build` · `npm run preview` · `npm run lint` (zero warnings) · `npm test`.

## Code Style
Plain JS/JSX (no TypeScript), 2-space indent, no semicolons, single quotes. Components `PascalCase.jsx`,
modules `kebab-case.js`. Each module starts with a header comment (役割 / 関係 / 流用元). UI text and
comments are Japanese.

## Adding a data source
1. Create `src/tools/<source>/{index,definitions,handlers}.js` (+ client).
2. Create `src/agent/skills/<source>.js` exporting a deterministic Markdown string.
3. Add the source to `SOURCES` in `src/tools/sources.js`. Tools return summaries, never full payloads.
4. Pass stores/callbacks through `agentDeps` in `App.jsx`; volatile state goes into `buildSystem`'s `contextParts`.

## Security
Claude and Gemini API keys are entered in the settings popover and stored in localStorage. Never commit keys.
The CSP in `vite.config.js` must allow any new external host.

## Commits
Conventional prefixes: `feat:` `fix:` `docs:` `refactor:` `perf:` `test:` `chore:` `style:`.
