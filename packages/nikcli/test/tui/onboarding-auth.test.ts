import { describe, expect, test } from "bun:test";
describe("onboarding account step", () => {
  test("requires the shared web OAuth flow before onboarding can continue", async () => {
    const onboardingSource = await Bun.file(
      new URL(
        "../../src/cli/cmd/tui/component/dialog-onboarding.tsx",
        import.meta.url,
      ),
    ).text();
    const appSource = await Bun.file(
      new URL("../../src/cli/cmd/tui/app.tsx", import.meta.url),
    ).text();
    expect(onboardingSource).toContain("<DialogAccountLogin");
    expect(onboardingSource).toContain("clearOnComplete={false}");
    expect(onboardingSource).not.toContain("UserDB.create(");
    expect(onboardingSource).not.toContain("Create a local account");
    expect(onboardingSource).not.toContain("Skip — I have an account");
    expect(onboardingSource).toMatch(
      /step\(\) !== STEP\.WELCOME\s*&&\s*step\(\) !== STEP\.ACCOUNT\s*&&\s*step\(\) !== STEP\.AI_PROVIDER/,
    );
    expect(appSource).toMatch(
      /do\s*{[\s\S]*DialogOnboarding\.run\(dialog\)[\s\S]*}\s*while\s*\(!postUser\)/,
    );
  });
});
