# @nikcli-ai/app

NikCLI Web Application - A SolidJS-based IDE interface inspired by OpenCode.

## Architecture

This package implements a full-featured web IDE interface using:

- **SolidJS** - Reactive UI framework
- **Vite** - Build tool and dev server
- **TailwindCSS** - Styling
- **@kobalte/core** - UI component library
- **@solidjs/router** - Client-side routing

## Structure

```
src/
├── components/
│   ├── layout/      # Layout components (sidebar, titlebar, etc.)
│   ├── editor/      # Code editor components
│   ├── terminal/    # Terminal components
│   ├── ui/          # Reusable UI components
│   ├── dialogs/     # Modal dialogs
│   └── input/       # Input components
├── context/         # State management (20+ contexts)
├── hooks/           # Custom hooks
├── lib/             # Utilities and API client
├── i18n/            # Internationalization (6 languages)
├── routes/          # Route pages (registered in app.tsx)
```

## Development

```bash
# Install dependencies
bun install

# Start dev server
bun run dev

# Build for production
bun run build

# Run type check
bun run typecheck
```

## Environment

```bash
VITE_NIKCLI_URL=http://localhost:4096
VITE_NIKCLI_USERNAME=nikcli
VITE_NIKCLI_PASSWORD=your-password
VITE_NIKCLI_DIRECTORY=/path/to/project
VITE_APP_VERSION=1.0.0
```

Notes:

- `VITE_NIKCLI_URL` (or `VITE_API_URL`) points to the Nikcli server.
- Username/password are optional and only used for auto-login. Credentials entered in Settings are saved in local storage.
- `VITE_NIKCLI_DIRECTORY` sets the `x-nikcli-directory` header for server scope.

## Deployment

Deployed automatically via SST to `app.nikcli.store`.

## Features

- Multi-session support
- Real-time collaboration
- Command palette
- Theme switching (light/dark/system)
- Internationalization (EN, IT, ES, FR, DE)
- Responsive layout
- Terminal integration
- Settings management
