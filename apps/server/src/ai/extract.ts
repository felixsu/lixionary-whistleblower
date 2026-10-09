import {
  REPORT_CATEGORIES,
  draftAssessmentSchema,
  type ChatMessage,
  type DraftAssessment,
} from "@whistle/shared";
import { AiError, type AiClient, type LlmMessage } from "./minimax.js";
import { EXTRACTION_PROMPT, transcriptForExtraction } from "./prompts.js";

/** Pulls the outermost JSON object out of model output that may carry fences or stray prose. */
export function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object found");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Repairs common small deviations before strict validation. */
function normalise(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const draft = (obj.draft ?? {}) as Record<string, unknown>;
  if (typeof draft.category !== "string" || !(REPORT_CATEGORIES as readonly string[]).includes(draft.category)) {
    draft.category = null;
  }
  if (typeof draft.title === "string") draft.title = draft.title.slice(0, 200);
  const details = (draft.details ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(details)) {
    if (value === null) details[key] = key === "ongoing" ? "unknown" : "";
  }
  if (typeof details.ongoing === "string") details.ongoing = details.ongoing.toLowerCase();
  if (!["yes", "no", "unknown"].includes(details.ongoing as string)) details.ongoing = "unknown";
  draft.details = details;
  const completeness = Number(obj.completeness);
  return {
    draft,
    completeness: Number.isFinite(completeness) ? Math.max(0, Math.min(100, Math.round(completeness))) : 0,
    missing: Array.isArray(obj.missing) ? obj.missing.filter((m) => typeof m === "string" && m.trim()).slice(0, 12) : [],
  };
}

export function parseAssessment(text: string): DraftAssessment {
  return draftAssessmentSchema.parse(normalise(extractJsonObject(text)));
}

/**
 * Asks the model to structure the conversation. Retries once with a corrective
 * message when the output isn't valid JSON for the schema.
 */
export async function assessConversation(ai: AiClient, messages: ChatMessage[]): Promise<DraftAssessment> {
  const prompt: LlmMessage[] = [
    { role: "system", content: EXTRACTION_PROMPT },
    { role: "user", content: transcriptForExtraction(messages) },
  ];
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const output = await ai.complete(prompt, { temperature: 0.3, maxTokens: 2048 });
    try {
      return parseAssessment(output);
    } catch (err) {
      lastError = err;
      prompt.push(
        { role: "assistant", content: output },
        {
          role: "user",
          content: "That was not a valid JSON object with the required shape. Reply with only the JSON object.",
        },
      );
    }
  }
  throw new AiError(`Could not parse the AI draft: ${(lastError as Error).message}`);
}
