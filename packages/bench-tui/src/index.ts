#!/usr/bin/env bun
import { runBenchTUI } from "./app"

const exitCode = await runBenchTUI()
if (exitCode !== 0) process.exit(exitCode)

export { runBenchTUI }
