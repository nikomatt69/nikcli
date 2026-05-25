#!/usr/bin/env bun
/**
 * Thin launcher — delegates to @nikcli-ai/bench-tui.
 * Canonical home: packages/bench-tui/src/app.tsx
 *
 * Usage (from nikcli dir):
 *   bun run test:bench:tui
 *   bun run dev
 *
 * @nikcli/bench-tui is a workspace package. After `bun install` the workspace
 * deps are linked so this import resolves at runtime. TypeScript needs
 * a separate type-stub file or installed node_modules to resolve the types.
 */
import { runBenchTUI } from "@nikcli-ai/bench-tui"
void runBenchTUI()
