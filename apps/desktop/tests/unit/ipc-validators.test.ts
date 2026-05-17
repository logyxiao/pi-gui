import { describe, expect, it } from "vitest";
import {
  assertApiKey,
  assertCommitMessage,
  assertHostUiResponse,
  assertModelsJson,
  assertNonEmptyString,
  assertNotificationPreferences,
  assertProviderId,
  assertProviderInput,
  assertString,
  assertWorkspaceId,
} from "../../electron/ipc-validators";

describe("assertNonEmptyString", () => {
  it("returns the string when valid", () => {
    expect(assertNonEmptyString("hello", "field")).toBe("hello");
  });

  it("rejects non-strings", () => {
    expect(() => assertNonEmptyString(42, "field")).toThrow(/field/);
    expect(() => assertNonEmptyString(undefined, "field")).toThrow();
    expect(() => assertNonEmptyString(null, "field")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => assertNonEmptyString("", "field")).toThrow(/empty/);
  });

  it("rejects strings longer than max", () => {
    expect(() => assertNonEmptyString("xxx", "field", 2)).toThrow(/≤ 2 chars/);
  });
});

describe("assertString", () => {
  it("accepts empty string", () => {
    expect(assertString("", "field")).toBe("");
  });

  it("rejects non-string", () => {
    expect(() => assertString(1, "field")).toThrow();
  });
});

describe("assertCommitMessage", () => {
  it("accepts a normal commit message", () => {
    expect(assertCommitMessage("feat: hi")).toBe("feat: hi");
  });

  it("rejects empty", () => {
    expect(() => assertCommitMessage("")).toThrow();
  });

  it("rejects messages over the cap", () => {
    expect(() => assertCommitMessage("x".repeat(16 * 1024 + 1))).toThrow();
  });
});

describe("assertWorkspaceId / assertProviderId / assertApiKey", () => {
  it("accepts non-empty strings", () => {
    expect(assertWorkspaceId("ws-1")).toBe("ws-1");
    expect(assertProviderId("p1")).toBe("p1");
    expect(assertApiKey("sk-test")).toBe("sk-test");
  });

  it("rejects empty workspace/provider ids", () => {
    expect(() => assertWorkspaceId("")).toThrow();
    expect(() => assertProviderId("")).toThrow();
  });

  it("allows empty api key (clearing)", () => {
    expect(assertApiKey("")).toBe("");
  });
});

describe("assertModelsJson", () => {
  it("accepts an empty providers map", () => {
    expect(assertModelsJson({ providers: {} })).toEqual({ providers: {} });
  });

  it("rejects non-object", () => {
    expect(() => assertModelsJson(null)).toThrow();
    expect(() => assertModelsJson(42)).toThrow();
    expect(() => assertModelsJson([])).toThrow();
  });

  it("rejects when providers missing", () => {
    expect(() => assertModelsJson({})).toThrow(/providers/);
  });

  it("validates provider fields", () => {
    expect(() =>
      assertModelsJson({
        providers: { p1: { baseUrl: 5 } },
      }),
    ).toThrow(/baseUrl/);
  });

  it("accepts a typical provider", () => {
    const value = {
      providers: {
        p1: {
          baseUrl: "https://api.example.com",
          api: "anthropic-messages",
          apiKey: "sk-1",
          headers: { "x-test": "1" },
          models: [{ id: "m1", enabled: true }],
        },
      },
    };
    expect(assertModelsJson(value)).toEqual(value);
  });

  it("rejects provider id length 0", () => {
    expect(() => assertModelsJson({ providers: { "": { baseUrl: "x" } } })).toThrow();
  });

  it("rejects too many providers", () => {
    const providers: Record<string, unknown> = {};
    for (let i = 0; i < 201; i += 1) providers[`p${i}`] = { baseUrl: "x" };
    expect(() => assertModelsJson({ providers })).toThrow(/≤ 200/);
  });

  it("rejects too many models per provider", () => {
    const models = Array.from({ length: 201 }, (_, i) => ({ id: `m${i}` }));
    expect(() =>
      assertModelsJson({ providers: { p1: { baseUrl: "x", models } } }),
    ).toThrow(/≤ 200/);
  });

  it("rejects non-string header values", () => {
    expect(() =>
      assertModelsJson({ providers: { p1: { baseUrl: "x", headers: { bad: 5 } } } }),
    ).toThrow(/headers/);
  });
});

describe("assertProviderInput", () => {
  it("requires baseUrl", () => {
    expect(() => assertProviderInput({ apiKey: "sk-1" })).toThrow(/baseUrl/);
  });

  it("accepts a probe input", () => {
    const value = { baseUrl: "https://x.example.com", apiKey: "sk-1" };
    expect(assertProviderInput(value)).toMatchObject(value);
  });
});

describe("assertHostUiResponse", () => {
  it("requires requestId", () => {
    expect(() => assertHostUiResponse({})).toThrow(/requestId/);
    expect(() => assertHostUiResponse({ requestId: "" })).toThrow();
  });

  it("returns the value when valid", () => {
    expect(assertHostUiResponse({ requestId: "abc", confirmed: true })).toEqual({
      requestId: "abc",
      confirmed: true,
    });
  });
});

describe("assertNotificationPreferences", () => {
  it("rejects non-object", () => {
    expect(() => assertNotificationPreferences("oops")).toThrow();
  });

  it("rejects non-boolean fields", () => {
    expect(() => assertNotificationPreferences({ backgroundCompletion: "yes" })).toThrow();
    expect(() => assertNotificationPreferences({ backgroundFailure: 1 })).toThrow();
    expect(() => assertNotificationPreferences({ attentionNeeded: null })).toThrow();
  });

  it("accepts partial valid preferences", () => {
    expect(
      assertNotificationPreferences({ backgroundCompletion: true }),
    ).toEqual({ backgroundCompletion: true });
  });
});
