import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import fs from "fs/promises";
import os from "os";
import path from "path";

const testHome = await fs.mkdtemp(
  path.join(os.tmpdir(), "nikcli-account-effect-home-"),
);
process.env.NIKCLI_TEST_HOME = testHome;

const { Account } = await import("@/account");

function runAccount<A, E>(effect: Effect.Effect<A, E, any>) {
  return Effect.runPromise(
    effect.pipe(Effect.provide(Account.defaultLayer)) as Effect.Effect<
      A,
      E,
      never
    >,
  );
}

describe("Account.Service", () => {
  beforeEach(async () => {
    await fs.rm(path.join(testHome, "data", "accounts.db"), { force: true });
    await fs.rm(path.join(testHome, "data", "accounts.db-shm"), {
      force: true,
    });
    await fs.rm(path.join(testHome, "data", "accounts.db-wal"), {
      force: true,
    });
    await fs.mkdir(path.join(testHome, "data"), { recursive: true });
  });

  it("provides local account operations through the Effect service boundary", async () => {
    const result = await runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service;
        return {
          config: yield* account.config(),
          list: yield* account.list(),
          active: yield* account.active(),
          removed: yield* account.remove("account_missing"),
        };
      }),
    );

    expect(result.config.serverUrl).toContain("https://");
    expect(result.list).toEqual([]);
    expect(result.active).toBeUndefined();
    expect(result.removed).toBe(false);
  });

  it("persists the verified OAuth profile when device login completes", async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);
      if (url.endsWith("oauth/device/token")) {
        return Response.json({
          status: "success",
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 900,
        });
      }
      if (url.endsWith("userinfo")) {
        return Response.json({
          id: "acc_remote",
          email: "New.User@Example.com",
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    try {
      const result = await runAccount(
        Effect.gen(function* () {
          const account = yield* Account.Service;
          const first = yield* account.poll("device-code-1" as never);
          const second = yield* account.poll("device-code-2" as never);
          return {
            first,
            second,
            active: yield* account.active(),
            accounts: yield* account.list(),
          };
        }),
      );

      expect(requests).toEqual([
        "https://auth.nikcli.store/oauth/device/token",
        "https://auth.nikcli.store/userinfo",
        "https://auth.nikcli.store/oauth/device/token",
        "https://auth.nikcli.store/userinfo",
      ]);
      expect(result.second.accountID).toBe(result.first.accountID);
      expect(result.accounts).toHaveLength(1);
      expect(result.active?.id).toBe(result.first.accountID);
      expect(result.active?.email).toBe("new.user@example.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not poll after OAuth login is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runAccount(
        Effect.gen(function* () {
          const account = yield* Account.Service;
          return yield* account.poll("cancelled-device-code" as never, {
            signal: controller.signal,
          });
        }),
      ),
    ).rejects.toThrow();
  });
});

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true });
});
