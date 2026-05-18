import { describe, expect, it } from "vitest";
import {
  computeEnabledModelPatterns,
  extractModelIds,
  normalizeModelsJson,
  parseUsageScript,
  stripJsonCommentsAndTrailingCommas,
  summarizeUsageResult,
  tryParseJson,
} from "../../electron/models-json-service";

describe("normalizeModelsJson", () => {
  it("returns empty providers for non-object input", () => {
    expect(normalizeModelsJson(null)).toEqual({ providers: {} });
    expect(normalizeModelsJson(undefined)).toEqual({ providers: {} });
    expect(normalizeModelsJson("string")).toEqual({ providers: {} });
  });

  it("filters non-object provider entries", () => {
    const result = normalizeModelsJson({ providers: { good: { baseUrl: "x" }, bad: 42 } });
    expect(Object.keys(result.providers)).toEqual(["good"]);
    expect(result.providers.good?.baseUrl).toBe("x");
  });

  it("only keeps known typed fields", () => {
    const result = normalizeModelsJson({
      providers: {
        p1: {
          baseUrl: "https://api.example.com",
          api: "anthropic-messages",
          apiKey: "sk-1",
          authHeader: true,
          headers: { "x-test": "1", bad: 5 },
          balanceBaseUrl: "https://api.example.com/v1/usage",
          balanceApiKey: "sk-2",
          usageScript: "({})",
          usageLastValue: "100",
          usageLastCheckedAt: "2026-05-17",
          enabled: true,
          compat: {
            supportsDeveloperRole: true,
            openaiProviderTools: { enabled: true, imageGeneration: true, outputDirectory: "images" },
          },
          unknownField: "drop me",
          models: [
            {
              id: "m1",
              enabled: true,
              compat: { openaiProviderTools: { imageGeneration: true, bad: "drop me" } },
            },
            "ignore-me",
          ],
        },
      },
    });
    const provider = result.providers.p1;
    expect(provider).toBeDefined();
    expect(provider).not.toHaveProperty("unknownField");
    expect(provider?.headers).toEqual({ "x-test": "1" });
    expect(provider?.compat).toEqual({
      supportsDeveloperRole: true,
      openaiProviderTools: { enabled: true, imageGeneration: true, outputDirectory: "images" },
    });
    expect(provider?.models).toEqual([
      { id: "m1", enabled: true, compat: { openaiProviderTools: { imageGeneration: true } } },
    ]);
  });

  it("drops empty model arrays", () => {
    const result = normalizeModelsJson({ providers: { p1: { baseUrl: "x", models: [] } } });
    expect(result.providers.p1).not.toHaveProperty("models");
  });
});

describe("computeEnabledModelPatterns", () => {
  it("expands empty model list to wildcard", () => {
    const patterns = computeEnabledModelPatterns({ providers: { p1: { enabled: true, models: [] } } });
    expect(patterns).toEqual(["p1/*"]);
  });

  it("excludes disabled providers", () => {
    const patterns = computeEnabledModelPatterns({
      providers: {
        p1: { enabled: false, models: [{ id: "m1" }] },
        p2: { enabled: true, models: [{ id: "m2" }] },
      },
    });
    expect(patterns).toEqual(["p2/m2"]);
  });

  it("excludes disabled models", () => {
    const patterns = computeEnabledModelPatterns({
      providers: {
        p1: { models: [{ id: "m1", enabled: true }, { id: "m2", enabled: false }] },
      },
    });
    expect(patterns).toEqual(["p1/m1"]);
  });

  it("returns wildcard if all models disabled", () => {
    const patterns = computeEnabledModelPatterns({
      providers: { p1: { models: [{ id: "m1", enabled: false }] } },
    });
    expect(patterns).toEqual(["p1/*"]);
  });
});

describe("stripJsonCommentsAndTrailingCommas", () => {
  it("removes single-line comments", () => {
    expect(stripJsonCommentsAndTrailingCommas('{"a": 1 // hi\n}')).toBe('{"a": 1 \n}');
  });

  it("removes block comments", () => {
    expect(stripJsonCommentsAndTrailingCommas('{"a": 1 /* drop */, "b": 2}')).toBe('{"a": 1 , "b": 2}');
  });

  it("removes trailing commas in objects and arrays", () => {
    expect(stripJsonCommentsAndTrailingCommas('{"a": [1, 2,], "b": 3,}')).toBe('{"a": [1, 2], "b": 3}');
  });

  it("preserves comment-like content inside strings", () => {
    expect(stripJsonCommentsAndTrailingCommas('{"url": "http://x/y // safe"}')).toBe('{"url": "http://x/y // safe"}');
  });

  it("preserves escaped quotes inside strings", () => {
    const input = '{"a": "she said \\"hi // not a comment\\""}';
    expect(stripJsonCommentsAndTrailingCommas(input)).toBe(input);
  });
});

describe("tryParseJson", () => {
  it("returns parsed value for valid JSON object", () => {
    expect(tryParseJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("returns parsed value for valid JSON array", () => {
    expect(tryParseJson('[1, 2]')).toEqual([1, 2]);
  });

  it("returns undefined for empty input", () => {
    expect(tryParseJson("")).toBeUndefined();
  });

  it("returns undefined when input is not an object/array", () => {
    expect(tryParseJson("42")).toBeUndefined();
    expect(tryParseJson('"hi"')).toBeUndefined();
  });

  it("returns undefined on parse error", () => {
    expect(tryParseJson("{ broken")).toBeUndefined();
  });
});

describe("extractModelIds", () => {
  it("extracts ids from data array", () => {
    expect(extractModelIds({ data: [{ id: "m1" }, { id: "m2" }] })).toEqual(["m1", "m2"]);
  });

  it("extracts ids from models array", () => {
    expect(extractModelIds({ models: [{ id: "x" }, { id: "y" }] })).toEqual(["x", "y"]);
  });

  it("dedupes and sorts ids", () => {
    expect(extractModelIds({ data: [{ id: "b" }, { id: "a" }, { id: "b" }] })).toEqual(["a", "b"]);
  });

  it("returns empty array for unknown shapes", () => {
    expect(extractModelIds(null)).toEqual([]);
    expect(extractModelIds({ other: "shape" })).toEqual([]);
  });
});

describe("parseUsageScript", () => {
  it("returns undefined for empty input", () => {
    expect(parseUsageScript(undefined)).toBeUndefined();
    expect(parseUsageScript("")).toBeUndefined();
    expect(parseUsageScript("   ")).toBeUndefined();
  });

  it("returns undefined when url cannot be extracted", () => {
    expect(parseUsageScript("{ no url here }")).toBeUndefined();
  });

  it("extracts url, method, body, headers", () => {
    const script = `({
      request: {
        url: "https://api.example.com/v1/usage",
        method: "GET",
        headers: { "Authorization": "Bearer abc", "X-Trace": "1" }
      }
    })`;
    const parsed = parseUsageScript(script);
    expect(parsed?.request.url).toBe("https://api.example.com/v1/usage");
    expect(parsed?.request.method).toBe("GET");
    expect(parsed?.request.headers).toEqual({ Authorization: "Bearer abc", "X-Trace": "1" });
  });
});

describe("summarizeUsageResult", () => {
  it("formats remaining + unit at top-level", () => {
    expect(summarizeUsageResult({ remaining: 9616.71891252, unit: "USD" })).toContain("USD");
    expect(summarizeUsageResult({ remaining: 9616.71891252, unit: "USD" })).toContain("9616.7");
  });

  it("falls back to nested quota.remaining", () => {
    const summary = summarizeUsageResult({ quota: { remaining: 100, unit: "USD" } });
    expect(summary).toContain("100");
  });

  it("returns serialized object when no remaining-like field present", () => {
    expect(summarizeUsageResult({ irrelevant: 1 })).toBe('{"irrelevant":1}');
  });

  it("falls back to ok for primitive non-string input", () => {
    expect(summarizeUsageResult(null)).toBe("ok");
    expect(summarizeUsageResult(undefined)).toBe("ok");
  });

  it("returns trimmed string for string input", () => {
    expect(summarizeUsageResult("100 USD remaining")).toBe("100 USD remaining");
  });
});
