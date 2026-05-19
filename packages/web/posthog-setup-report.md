<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the nikcli Astro web project (`packages/web`). PostHog is initialized via the CDN snippet in a reusable `posthog.astro` component, injected into the root `Layout.astro` so every page is covered. Environment variables (`PUBLIC_POSTHOG_PROJECT_TOKEN`, `PUBLIC_POSTHOG_HOST`) are stored in `packages/web/.env` and referenced via `import.meta.env`. TypeScript global types for `window.posthog` were added to `src/env.d.ts`.

Twelve custom events are tracked across 7 files, covering the full user journey from landing page intent to dashboard feature usage. User identification (via `posthog.identify`) fires on login and registration, and `posthog.reset()` is called on logout to clear the session. Error tracking via `posthog.captureException()` is added to all critical auth and CRUD failure paths.

| Event                    | Description                                         | File                                        |
| ------------------------ | --------------------------------------------------- | ------------------------------------------- |
| `install_command_copied` | User copied the install command on the landing page | `src/components/InstallBlock.astro`         |
| `hero_cta_clicked`       | User clicked Start Building or Documentation CTA    | `src/components/Hero.astro`                 |
| `user_signed_up`         | User successfully registered a new account          | `src/dashboard/components/RegisterForm.tsx` |
| `user_signed_in`         | User successfully logged in                         | `src/dashboard/auth/AuthContext.tsx`        |
| `user_signed_out`        | User logged out of the dashboard                    | `src/dashboard/auth/AuthContext.tsx`        |
| `session_created`        | User initiated a new AI session                     | `src/dashboard/components/SessionsPage.tsx` |
| `agent_created`          | User created a custom AI agent                      | `src/dashboard/components/AgentsPage.tsx`   |
| `skill_created`          | User created a new skill prompt                     | `src/dashboard/components/SkillsPage.tsx`   |
| `skill_deleted`          | User deleted a skill                                | `src/dashboard/components/SkillsPage.tsx`   |
| `skills_bulk_imported`   | User imported skills from GitHub URLs               | `src/dashboard/components/SkillsPage.tsx`   |
| `mcp_server_added`       | User added a new MCP server integration             | `src/dashboard/components/McpPage.tsx`      |
| `mcp_server_removed`     | User removed an MCP server integration              | `src/dashboard/components/McpPage.tsx`      |

## Next steps

Events are now flowing to PostHog. To build an "Analytics basics" dashboard with the recommended insights, visit your PostHog project and create:

1. **Acquisition funnel** — `install_command_copied` → `user_signed_up` → `user_signed_in` — tracks top-of-funnel conversion from the landing page
2. **Hero CTA engagement** — Trends for `hero_cta_clicked` broken down by `label` property (`start_building` vs `documentation`)
3. **Feature adoption** — Trends for `session_created`, `agent_created`, `skill_created`, `mcp_server_added` overlaid on one chart
4. **User retention** — Retention insight using `user_signed_in` as the returning event
5. **Churn signals** — Trends for `user_signed_out` and `mcp_server_removed` / `skill_deleted`

Suggested links (once events start arriving):

- [Events explorer](/data-management/events)
- [Create a new insight](/insights/new)
- [Create a dashboard](/dashboard/new)

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-astro-static/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
