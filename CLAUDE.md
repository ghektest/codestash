# CodeStash - Development Guide

## Overview

CodeStash is a local-first CLI tool for saving, searching, and syncing code snippets. It uses SQLite for storage and Fuse.js for fuzzy search.

## Build & Development

```bash
npm install
npm run build        # Compile TypeScript
npm run dev          # Watch mode with tsx
npm run check        # Run lint + typecheck (same as CI)
```

## Linting & Formatting

We use Biome for linting and formatting. Always run before committing:

```bash
npm run lint         # Check for issues
npm run lint:fix     # Auto-fix issues
npm run format       # Format code
```

## Type Checking

```bash
npm run typecheck    # Run tsc --noEmit
```

## Testing

```bash
npm test             # Run vitest
npm run test:watch   # Watch mode
```

## Architecture

- `src/cli.ts` - CLI entry point using Commander.js
- `src/store.ts` - SQLite storage layer (better-sqlite3)
- `src/search.ts` - Fuzzy search engine (Fuse.js)
- `src/types.ts` - Shared types and Zod schemas
- `src/sync.ts` - File-based sync logic for cross-machine usage

## Code Style

- Use `const`/`let`, never `var`
- Always use semicolons
- Use double quotes for strings
- Use template literals instead of string concatenation
- Avoid `any` types where possible

## CI

CI runs `npm run check` which includes both Biome lint and TypeScript type checking. PRs must pass both before merge.
