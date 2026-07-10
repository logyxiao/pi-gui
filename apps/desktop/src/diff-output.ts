export function extractDiffFromOutput(output: unknown): string | undefined {
  if (typeof output === "string" && (output.includes("@@") || output.startsWith("diff "))) return output;
  if (!isObject(output)) return undefined;
  if (typeof output.diff === "string") return output.diff;
  if (isObject(output.details) && typeof output.details.diff === "string") return output.details.diff;
  if (!Array.isArray(output.content)) return undefined;
  for (const part of output.content) {
    if (isObject(part) && part.type === "text" && typeof part.text === "string" &&
      (part.text.includes("@@") || part.text.startsWith("diff "))) return part.text;
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
