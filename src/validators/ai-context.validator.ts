import { z } from "zod";

/**
 * Validates the structured response from Workers AI (Llama 3 / Gemma)
 * when generating contextual analysis for triggered alerts.
 * Ensures the AI output contains all required fields with proper types.
 */
export const aiContextValidator = z.object({
  message: z.string().min(1),
  probableCause: z.string().min(1),
  recommendedAction: z.string().min(1),
  urgency: z.enum(["critical", "high", "medium", "low"]),
}).strict();

export type AiContextOutput = z.infer<typeof aiContextValidator>;