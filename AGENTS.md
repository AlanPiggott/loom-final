# Repository Guidelines

## Project Structure & Module Organization
Two active packages sit at the root. `vidgen-app/` hosts the Next.js dashboard (App Router) with core UI in `src/app/(app)/dashboard` and shared flows in `src/components`. `loom-lite/` provides the Express rendering engine; its `src/server.js` exposes `/api/render` while compositing and worker code lives in `src/pipeline` and `src/lib`. Playwright fixtures and rendered assets stay under `loom-lite/campaigns/`. Refer to `SETUP.md` for the high-level dual-server diagram when touching cross-service integrations.

## Build, Test, and Development Commands
From `/vidgen-app`, use `pnpm install`, `pnpm dev` for local UI, `pnpm build` for production checks, and `pnpm lint` before submitting. In `/loom-lite`, run `npm install` once, then `npm start` (or `pnpm start`) to expose the render API and `npm run dev` for a nodemon loop. `npm run worker` runs the background renderer, and `npm run render:sample campaigns/sample/config.json` is the quickest smoke test against sample data.

## Coding Style & Naming Conventions
Frontend code is TypeScript + JSX with Tailwind utility classes; prefer functional components, React hooks, and descriptive prop names. Keep indentation at two spaces and wrap JSX around 100 characters to match existing files. Backend modules are CommonJS; camelCase functions and kebab-case or snake_case filenames mirror the current patterns. Run `pnpm lint` in `vidgen-app` to satisfy the Next.js ESLint rules before opening a review.

## Testing Guidelines
Browser-level checks live as Playwright scripts in `loom-lite/test-*.js`. Execute targeted runs via `node test-simple-recording.js` (or another scenario file) after changing rendering logic. For UI work, verify the `/dashboard` flow end-to-end with both servers running and confirm render results appear in `loom-lite/campaigns/`. New test utilities should follow the `test-*.js` naming and document any required fixtures in the script header.

## Commit & Pull Request Guidelines
Commits follow a Conventional Commit style—see recent examples like `feat:` and `docs:` in `git log`. Keep messages scoped to the affected package (e.g., `fix(vidgen-app): update wizard validation`). Pull requests should include: a concise summary, linked tickets, screenshots or gifs for UI updates, and notes on new env vars or migrations. Call out any manual verification performed so reviewers can replicate quickly.

## Environment & Security Notes
Secrets stay out of version control. Populate `vidgen-app/.env.local` with Supabase keys and `LOOM_LITE_URL`; `loom-lite/.env` controls the render port. Validate backend health with `curl http://localhost:3100/api/health` before demos. Rendering requires Playwright plus FFmpeg, so document OS-specific steps (see `SUPABASE_STORAGE_SETUP.md`) when onboarding new contributors. Scrub temporary recordings from `loom-lite/campaigns/` before pushing to avoid leaking prospect data.
