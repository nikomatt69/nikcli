# CodeMode Interpreter Support

| Field  | Value                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------- |
| Status | **Accepted and implemented** (T4, 2026-09-09)                                                   |
| Scope  | `src/codemode/interpreter/*`, `src/codemode/stdlib/*`, `test/codemode/*`                        |
| Buys   | A subset that was decided rather than inherited, and refusals a model can act on the first time |

`code_mode` is on by default (opt-out `NIKCLI_DISABLE_CODE_MODE`), so this interpreter is a surface the
model writes against on ordinary turns. What it accepts is therefore a product decision, not an
implementation detail — and until T4 it was neither: the subset was whatever the fork happened to
carry when `src/codemode` was taken from opencode.

This document is the matrix. The code is authority when they disagree.

---

## Why a subset at all

The interpreter exists so tool orchestration can be written as code instead of as a chain of separate
model turns. It is a tree-walking evaluator over Effect, with no host `eval`, no prototype access, and
facade objects (`CodeModeSet`, `CodeModeMap`, …) instead of host built-ins. Every construct it accepts
has to be implemented, bounded, and kept safe by hand, so breadth is a cost paid per feature.

The test that decides a feature's fate is not "is this valid JavaScript" but **does orchestration code
need it, and does refusing it cost a turn?** A refusal the model can act on is cheap. A refusal it
retries is not.

---

## Supported

| Area         | What works                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Functions    | Plain and `async` function declarations, function expressions, arrow functions, closures                                                                                                               |
| Control flow | `if`/`else`, `switch`, `while`, `do…while`, `for`, `for…of`, `for…in`, `try`/`catch`/`finally`, `throw`                                                                                                |
| Labels       | Labelled loops and labelled blocks, `break label`, `continue label`                                                                                                                                    |
| Data         | Object and array literals, destructuring, spread, optional chaining, template literals                                                                                                                 |
| Async        | `await`, `Promise.all` / `allSettled` / `race` / `any` / `resolve` / `reject`, `.then` / `.catch` / `.finally`                                                                                         |
| Construction | `new` for `Promise`, `Map`, `Set`, `Date`, `RegExp`, `URL`, `URLSearchParams`, and the error constructors                                                                                              |
| Built-ins    | `Array`, `Object` (incl. `groupBy`), `Math`, `JSON`, `String`, `Number`, `Date`, `RegExp`, `Map` (incl. `groupBy`), `Set` (incl. ES2025 composition), `URL`, `URLSearchParams`, `console`, URI helpers |
| Tools        | `tools.*` calls returning promises, `for…in` over `tools` namespaces                                                                                                                                   |

### Set composition and grouping

`union`, `intersection`, `difference`, `symmetricDifference`, `isSubsetOf`, `isSupersetOf`, and
`isDisjointFrom` are present because "which paths did both greps return?" is orchestration, and the
alternative is a hand-written filter over two arrays. They take **another Set**, not any set-like: the
real methods accept set-likes, but accepting an array here would make `s.union([1, 2])` return a
plausible wrong answer instead of a refusal.

`Object.groupBy` and `Map.groupBy` are dispatched from `interpreter/methods.ts` rather than
`stdlib/object.ts`, because they take a callback and the pure statics have no access to the callback
runner. `Object.groupBy` returns a null-prototype object keyed by the stringified group and enforces
the same blocked-member guard as every other model-chosen key; `Map.groupBy` keys by the raw value.

---

## Excluded, and why

These are decisions. Each one refuses with a message naming the construct **and** the replacement, and
each is named in `supportedSyntaxMessage` — the paragraph attached to every syntax refusal. Naming the
exclusion is the point: a model that reads "generators are unavailable" writes a loop, while one that
reads a list it is merely absent from tries `function*` again.

| Excluded                           | Why                                                                                                                                                                | Write instead                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Generator functions, `yield`       | Suspending and resuming needs the evaluator to be a coroutine; this one walks the tree over Effect, so `yield` would have to reify the continuation at every node. | Build and return an array                               |
| `for await…of`                     | Same machinery, and it buys nothing here: `await` inside `for…of` is already sequential, `Promise.all` is already concurrent.                                      | `for…of` with `await`, or `Promise.all(items.map(...))` |
| Classes, user-defined constructors | Prototypes and `this` are the part of the language the facade model exists to avoid.                                                                               | A function returning a plain object                     |
| `this`, getters/setters            | Same.                                                                                                                                                              | Explicit parameters and plain properties                |
| Tagged templates, BigInt, `Symbol` | No orchestration demand observed; each is a separate value domain to bound.                                                                                        | —                                                       |

An exclusion moves only when a real turn is observed losing to it. "Upstream has it" is not the test —
that is how the subset became undecided in the first place.

---

## How a refusal must read

Three rules, each of which existed as a live defect before T4:

1. **A refusal must not misname itself.** `new` on a non-constructible callee reported
   `UnsupportedSyntax: Syntax 'NewExpression' is not supported` — one line after a hint saying
   `new Promise(...)` works. It is now a `TypeError` naming the callee, matching JavaScript.
2. **A refusal must point at the right thing.** Calling a method that is not in the subset
   (`new Set([1]).nope()`) reported `Only tools are callable in CodeMode`, sending the model to look at
   its tools when one method was the problem. It is now `nope is not a function.`
3. **A binding beats the built-in table.** Construction used to be keyed by name, so
   `const Date = 5; new Date()` built a real date from a value the program had already replaced.
   Builtins are themselves scope bindings, so the check is whether the name still resolves to _its own_
   ambient global.

---

## Where the tests are

| Suite                                      | Covers                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `test/codemode/labeled-control.test.ts`    | Labels across all five loop forms, labelled blocks, and the switch boundary |
| `test/codemode/new-expression.test.ts`     | Non-constructible callees, shadowed builtins, non-callable members          |
| `test/codemode/set-methods.test.ts`        | Set composition, both `groupBy` forms, and their refusals                   |
| `test/codemode/unsupported-syntax.test.ts` | That each exclusion refuses with a replacement, and that the hint names it  |

The upstream this was forked from carries test262-derived suites for the areas it supports and this one
does not. Those are not vendored: they would assert a language surface this subset has decided against,
so they would fail by design rather than find anything.
