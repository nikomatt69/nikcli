#!/bin/bash
# Start the NikCLI Discord bot (Gateway websocket — no inbound tunnel).
exec bun run src/index.ts
