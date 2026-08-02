# AI SDK audit

Stable same-major updates verified on 2026-08-01.

---

## Declarations

`ai` is declared in the root `package.json` catalog and consumed by `packages/nikcli/package.json` through `catalog:`. All direct provider dependencies are declared in `packages/nikcli/package.json`.

No dependencies, manifests, or lockfiles were changed.

---

## Available updates

There are 21 eligible updates: 20 patch releases and one minor release.

| Package                      | Location / declaration          | Current |  Target | Update type | Npm target                                                                 | Changelog / releases                                                                        |
| ---------------------------- | ------------------------------- | ------: | ------: | ----------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ai`                         | Root catalog; nikcli `catalog:` | 5.0.173 | 5.0.224 | Patch       | [5.0.224](https://www.npmjs.com/package/ai/v/5.0.224)                      | [Changelog](https://github.com/vercel/ai/blob/main/packages/ai/CHANGELOG.md)                |
| `@ai-sdk/provider`           | Nikcli dependency               |   2.0.1 |   2.0.3 | Patch       | [2.0.3](https://www.npmjs.com/package/@ai-sdk/provider/v/2.0.3)            | [Changelog](https://github.com/vercel/ai/blob/main/packages/provider/CHANGELOG.md)          |
| `@ai-sdk/provider-utils`     | Nikcli dependency               |  3.0.23 |  3.0.31 | Patch       | [3.0.31](https://www.npmjs.com/package/@ai-sdk/provider-utils/v/3.0.31)    | [Changelog](https://github.com/vercel/ai/blob/main/packages/provider-utils/CHANGELOG.md)    |
| `@ai-sdk/gateway`            | Nikcli dependency               |  2.0.77 | 2.0.123 | Patch       | [2.0.123](https://www.npmjs.com/package/@ai-sdk/gateway/v/2.0.123)         | [Changelog](https://github.com/vercel/ai/blob/main/packages/gateway/CHANGELOG.md)           |
| `@ai-sdk/vercel`             | Nikcli dependency               |  1.0.36 |  1.0.48 | Patch       | [1.0.48](https://www.npmjs.com/package/@ai-sdk/vercel/v/1.0.48)            | [Changelog](https://github.com/vercel/ai/blob/main/packages/vercel/CHANGELOG.md)            |
| `@ai-sdk/openai`             | Nikcli dependency               | 2.0.102 | 2.0.117 | Patch       | [2.0.117](https://www.npmjs.com/package/@ai-sdk/openai/v/2.0.117)          | [Changelog](https://github.com/vercel/ai/blob/main/packages/openai/CHANGELOG.md)            |
| `@ai-sdk/anthropic`          | Nikcli dependency               |  2.0.74 |  2.0.92 | Patch       | [2.0.92](https://www.npmjs.com/package/@ai-sdk/anthropic/v/2.0.92)         | [Changelog](https://github.com/vercel/ai/blob/main/packages/anthropic/CHANGELOG.md)         |
| `@ai-sdk/azure`              | Nikcli dependency               | 2.0.104 | 2.0.122 | Patch       | [2.0.122](https://www.npmjs.com/package/@ai-sdk/azure/v/2.0.122)           | [Changelog](https://github.com/vercel/ai/blob/main/packages/azure/CHANGELOG.md)             |
| `@ai-sdk/google`             | Nikcli dependency               |  2.0.68 |  2.0.86 | Patch       | [2.0.86](https://www.npmjs.com/package/@ai-sdk/google/v/2.0.86)            | [Changelog](https://github.com/vercel/ai/blob/main/packages/google/CHANGELOG.md)            |
| `@ai-sdk/google-vertex`      | Nikcli dependency               | 3.0.128 | 3.0.159 | Patch       | [3.0.159](https://www.npmjs.com/package/@ai-sdk/google-vertex/v/3.0.159)   | [Changelog](https://github.com/vercel/ai/blob/main/packages/google-vertex/CHANGELOG.md)     |
| `@ai-sdk/amazon-bedrock`     | Nikcli dependency               |  3.0.93 | 3.0.112 | Patch       | [3.0.112](https://www.npmjs.com/package/@ai-sdk/amazon-bedrock/v/3.0.112)  | [Changelog](https://github.com/vercel/ai/blob/main/packages/amazon-bedrock/CHANGELOG.md)    |
| `@ai-sdk/cerebras`           | Nikcli dependency               |  1.0.40 |  1.0.52 | Patch       | [1.0.52](https://www.npmjs.com/package/@ai-sdk/cerebras/v/1.0.52)          | [Changelog](https://github.com/vercel/ai/blob/main/packages/cerebras/CHANGELOG.md)          |
| `@ai-sdk/cohere`             | Nikcli dependency               |  2.0.25 |  2.0.35 | Patch       | [2.0.35](https://www.npmjs.com/package/@ai-sdk/cohere/v/2.0.35)            | [Changelog](https://github.com/vercel/ai/blob/main/packages/cohere/CHANGELOG.md)            |
| `@ai-sdk/deepinfra`          | Nikcli dependency               |  1.0.38 |  1.0.50 | Patch       | [1.0.50](https://www.npmjs.com/package/@ai-sdk/deepinfra/v/1.0.50)         | [Changelog](https://github.com/vercel/ai/blob/main/packages/deepinfra/CHANGELOG.md)         |
| `@ai-sdk/groq`               | Nikcli dependency               |  2.0.37 |  2.0.47 | Patch       | [2.0.47](https://www.npmjs.com/package/@ai-sdk/groq/v/2.0.47)              | [Changelog](https://github.com/vercel/ai/blob/main/packages/groq/CHANGELOG.md)              |
| `@ai-sdk/mistral`            | Nikcli dependency               |  2.0.30 |  2.0.41 | Patch       | [2.0.41](https://www.npmjs.com/package/@ai-sdk/mistral/v/2.0.41)           | [Changelog](https://github.com/vercel/ai/blob/main/packages/mistral/CHANGELOG.md)           |
| `@ai-sdk/openai-compatible`  | Nikcli dependency               |  1.0.35 |  1.0.47 | Patch       | [1.0.47](https://www.npmjs.com/package/@ai-sdk/openai-compatible/v/1.0.47) | [Changelog](https://github.com/vercel/ai/blob/main/packages/openai-compatible/CHANGELOG.md) |
| `@ai-sdk/perplexity`         | Nikcli dependency               |  2.0.27 |  2.0.37 | Patch       | [2.0.37](https://www.npmjs.com/package/@ai-sdk/perplexity/v/2.0.37)        | [Changelog](https://github.com/vercel/ai/blob/main/packages/perplexity/CHANGELOG.md)        |
| `@ai-sdk/togetherai`         | Nikcli dependency               |  1.0.38 |  1.0.51 | Patch       | [1.0.51](https://www.npmjs.com/package/@ai-sdk/togetherai/v/1.0.51)        | [Changelog](https://github.com/vercel/ai/blob/main/packages/togetherai/CHANGELOG.md)        |
| `@ai-sdk/xai`                | Nikcli dependency               |  2.0.67 |  2.0.84 | Patch       | [2.0.84](https://www.npmjs.com/package/@ai-sdk/xai/v/2.0.84)               | [Changelog](https://github.com/vercel/ai/blob/main/packages/xai/CHANGELOG.md)               |
| `@gitlab/gitlab-ai-provider` | Nikcli dependency               |   3.1.3 |   3.6.1 | Minor       | [3.6.1](https://www.npmjs.com/package/@gitlab/gitlab-ai-provider/v/3.6.1)  | [Releases](https://gitlab.com/gitlab-org/editor-extensions/gitlab-ai-provider/-/releases)   |

---

## Up-to-date package and caveat

`@openrouter/ai-sdk-provider` is current at `1.5.4` within its major: [npm](https://www.npmjs.com/package/@openrouter/ai-sdk-provider/v/1.5.4) and [releases](https://github.com/OpenRouterTeam/ai-sdk-provider/releases). Root `package.json` applies a local patch specifically to `1.5.4`, so any future upgrade requires porting and revalidating that patch.

---

## Methodology

This audit compares the two source manifests as of 2026-08-01. Targets are stable releases resolved from each package's npm/unpkg same-major selector, selecting the highest version without a major upgrade.

Current values come from declarations rather than lockfile resolution. Package pages and upstream changelogs or release pages provide the verification references.

---

## Scope exclusions

Scope includes `ai`, every declared `@ai-sdk/*` package, `@openrouter/ai-sdk-provider`, and `@gitlab/gitlab-ai-provider`. Generic SDKs and unrelated integrations, including MCP, ACP, and browser-use, are explicitly excluded.

---

## Rollout guidance

Update the Vercel AI SDK family together because its packages have peer and internal version coupling. Review each linked changelog or package page before updating, then validate provider integrations as one change set.
