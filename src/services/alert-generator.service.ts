import { aiContextValidator, type AiContextOutput } from "../validators/ai-context.validator";
import type { RuleEvaluationResult } from "./rule-engine.types";
import type { Ai } from "@cloudflare/workers-types";

const AI_MODEL = "@cf/meta/llama-3-8b-instruct" as const;
const AI_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 2;

const SYSTEM_PROMPT =
  "Eres un asistente especializado en monitoreo industrial IoT. " +
  "Tu función es generar alertas contextuales en español con análisis de causa probable y acciones recomendadas. " +
  "Debes responder ÚNICAMENTE con un objeto JSON válido, sin texto adicional ni bloques de código markdown. " +
  "El JSON debe tener exactamente estos campos: message, probableCause, recommendedAction, urgency.";

const URGENCY_MAP: Record<RuleEvaluationResult["ruleType"], AiContextOutput["urgency"]> = {
  critical_threshold: "critical",
  y2_differential: "high",
  consecutive_streak: "medium",
  standard_deviation: "low",
};

interface AlertGeneratorEnv {
  AI: Ai;
}

export async function generateAlertContext(
  ruleResult: RuleEvaluationResult,
  env: AlertGeneratorEnv,
): Promise<AiContextOutput> {
  const prompt = buildSpanishPrompt(ruleResult);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

      const response = await env.AI.run(
        AI_MODEL,
        {
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        },
        { signal: controller.signal },
      );

      clearTimeout(timeoutId);

      const parsed = parseAIResponse(response);
      const validated = aiContextValidator.safeParse(parsed);

      if (validated.success) {
        return validated.data;
      }
    } catch {
      // AI call, timeout, or validation failed — retry if attempts remain
    }
  }

  return buildDeterministicFallback(ruleResult);
}

function buildSpanishPrompt(ruleResult: RuleEvaluationResult): string {
  const severity = URGENCY_MAP[ruleResult.ruleType] ?? "medium";

  return [
    "Genera un análisis contextual para la siguiente alerta de monitoreo industrial:",
    "",
    `Tipo de sensor: ${ruleResult.sensorType}`,
    `Severidad: ${severity}`,
    `Valor actual: ${ruleResult.currentValue}`,
    `Umbral configurado: ${ruleResult.thresholdValue}`,
    `Tipo de regla: ${ruleResult.ruleType}`,
    "",
    "Responde en formato JSON con los campos: message, probableCause, recommendedAction, urgency (critical, high, medium, low).",
  ].join("\n");
}

function parseAIResponse(response: unknown): unknown {
  if (typeof response === "object" && response !== null && "response" in response) {
    const text = (response as { response?: string }).response ?? "";
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
  return response;
}

export function buildDeterministicFallback(
  ruleResult: RuleEvaluationResult,
): AiContextOutput {
  const severity = URGENCY_MAP[ruleResult.ruleType] ?? "medium";

  return {
    message: `Alerta ${severity}: Sensor ${ruleResult.sensorType} registró ${ruleResult.currentValue}, umbral ${ruleResult.thresholdValue}`,
    probableCause: "Valor fuera del rango configurado",
    recommendedAction: "Verificar el sensor y las condiciones del equipo",
    urgency: severity,
  };
}