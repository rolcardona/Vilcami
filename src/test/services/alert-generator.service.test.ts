import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiContextOutput } from "../../validators/ai-context.validator";
import type { RuleEvaluationResult } from "../../services/rule-engine.types";

const AI_MODEL = "@cf/meta/llama-3-8b-instruct";

function createMockEnv(aiRunMock: ReturnType<typeof vi.fn>): { AI: Ai } {
  return { AI: { run: aiRunMock } } as unknown as { AI: Ai };
}

function createTriggeredRuleResult(
  overrides?: Partial<RuleEvaluationResult>,
): RuleEvaluationResult {
  return {
    ruleId: "rule-temp-001",
    sensorType: "temperature",
    ruleType: "critical_threshold",
    triggered: true,
    currentValue: 85.5,
    thresholdValue: 80,
    details: "Sensor temperature (85.5) exceeded threshold (80)",
    ...overrides,
  };
}

const VALID_AI_OUTPUT: AiContextOutput = {
  message: "Temperatura crítica detectada en el sensor",
  probableCause: "Falla en el sistema de refrigeración",
  recommendedAction: "Verificar sistema de refrigeración de inmediato",
  urgency: "critical",
};

describe("generateAlertContext", () => {
  let generateAlertContext: (
    ruleResult: RuleEvaluationResult,
    env: { AI: Ai },
  ) => Promise<AiContextOutput>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import("../../services/alert-generator.service");
    generateAlertContext = module.generateAlertContext;
  });

  it("should call env.AI.run() with structured prompt", async () => {
    const aiRunMock = vi.fn().mockResolvedValue({
      response: JSON.stringify(VALID_AI_OUTPUT),
    });
    const env = createMockEnv(aiRunMock);

    await generateAlertContext(createTriggeredRuleResult(), env);

    expect(aiRunMock).toHaveBeenCalledOnce();
    expect(aiRunMock).toHaveBeenCalledWith(
      AI_MODEL,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({ role: "user" }),
        ]),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("should return validated AiContextOutput on success", async () => {
    const aiRunMock = vi.fn().mockResolvedValue({
      response: JSON.stringify(VALID_AI_OUTPUT),
    });
    const env = createMockEnv(aiRunMock);

    const result = await generateAlertContext(
      createTriggeredRuleResult(),
      env,
    );

    expect(result).toEqual(VALID_AI_OUTPUT);
  });

  it("should fall back to deterministic template on AI failure", async () => {
    const aiRunMock = vi
      .fn()
      .mockRejectedValue(new Error("AI service unavailable"));
    const env = createMockEnv(aiRunMock);

    const result = await generateAlertContext(
      createTriggeredRuleResult(),
      env,
    );

    expect(result.message).toBe(
      "Alerta critical: Sensor temperature registró 85.5, umbral 80",
    );
    expect(result.probableCause).toBe(
      "Valor fuera del rango configurado",
    );
    expect(result.recommendedAction).toBe(
      "Verificar el sensor y las condiciones del equipo",
    );
    expect(result.urgency).toBe("critical");
  });

  it("should fall back on timeout (5 second limit)", async () => {
    // When the AbortController fires after 5s, AI.run() rejects with
    // AbortError. Verify the function falls back to deterministic template.
    const abortError = new DOMException(
      "The operation was aborted",
      "AbortError",
    );
    const aiRunMock = vi
      .fn()
      .mockRejectedValueOnce(abortError)
      .mockRejectedValueOnce(abortError);
    const env = createMockEnv(aiRunMock);

    const result = await generateAlertContext(
      createTriggeredRuleResult(),
      env,
    );

    expect(result.message).toContain("Alerta");
    expect(result.urgency).toBe("critical");
    // Both attempts (initial + retry) should have been tried
    expect(aiRunMock).toHaveBeenCalledTimes(2);
    // Verify AbortSignal is passed to enable timeout mechanism
    expect(aiRunMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("should fall back on Zod validation failure (malformed AI response)", async () => {
    const malformedResponse = {
      response: JSON.stringify({ wrong: "fields", missing: true }),
    };
    const aiRunMock = vi.fn().mockResolvedValue(malformedResponse);
    const env = createMockEnv(aiRunMock);

    const result = await generateAlertContext(
      createTriggeredRuleResult(),
      env,
    );

    expect(result.message).toContain("Alerta");
    expect(result.probableCause).toBe(
      "Valor fuera del rango configurado",
    );
  });

  it("should retry once before fallback", async () => {
    const aiRunMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("First attempt failed"))
      .mockRejectedValueOnce(new Error("Second attempt failed"));
    const env = createMockEnv(aiRunMock);

    const result = await generateAlertContext(
      createTriggeredRuleResult(),
      env,
    );

    expect(aiRunMock).toHaveBeenCalledTimes(2);
    expect(result.message).toContain("Alerta");
  });

  it("should generate Spanish language prompt", async () => {
    const aiRunMock = vi.fn().mockResolvedValue({
      response: JSON.stringify(VALID_AI_OUTPUT),
    });
    const env = createMockEnv(aiRunMock);

    await generateAlertContext(createTriggeredRuleResult(), env);

    const callArgs = aiRunMock.mock.calls[0];
    const messages = callArgs[1].messages as Array<{
      role: string;
      content: string;
    }>;
    const userMessage = messages.find((m) => m.role === "user");

    expect(userMessage?.content).toContain("sensor");
    expect(userMessage?.content.toLowerCase()).toContain("umbral");
  });

  it("should include sensor type, severity, current value, and threshold in prompt", async () => {
    const aiRunMock = vi.fn().mockResolvedValue({
      response: JSON.stringify(VALID_AI_OUTPUT),
    });
    const env = createMockEnv(aiRunMock);
    const ruleResult = createTriggeredRuleResult({
      sensorType: "pressure",
      currentValue: 150.3,
      thresholdValue: 120,
      ruleType: "y2_differential",
    });

    await generateAlertContext(ruleResult, env);

    const callArgs = aiRunMock.mock.calls[0];
    const messages = callArgs[1].messages as Array<{
      role: string;
      content: string;
    }>;
    const userMessage = messages.find((m) => m.role === "user");
    const promptContent = userMessage?.content ?? "";

    expect(promptContent).toContain("pressure");
    expect(promptContent).toContain("150.3");
    expect(promptContent).toContain("120");
  });
});

describe("buildDeterministicFallback", () => {
  let buildDeterministicFallback: (
    ruleResult: RuleEvaluationResult,
  ) => AiContextOutput;

  beforeEach(async () => {
    const module = await import("../../services/alert-generator.service");
    buildDeterministicFallback = module.buildDeterministicFallback;
  });

  it("should map critical_threshold to critical urgency", () => {
    const result = buildDeterministicFallback(
      createTriggeredRuleResult({ ruleType: "critical_threshold" }),
    );
    expect(result.urgency).toBe("critical");
    expect(result.message).toContain("critical");
  });

  it("should map y2_differential to high urgency", () => {
    const result = buildDeterministicFallback(
      createTriggeredRuleResult({ ruleType: "y2_differential" }),
    );
    expect(result.urgency).toBe("high");
    expect(result.message).toContain("high");
  });

  it("should map consecutive_streak to medium urgency", () => {
    const result = buildDeterministicFallback(
      createTriggeredRuleResult({ ruleType: "consecutive_streak" }),
    );
    expect(result.urgency).toBe("medium");
    expect(result.message).toContain("medium");
  });

  it("should map standard_deviation to low urgency", () => {
    const result = buildDeterministicFallback(
      createTriggeredRuleResult({ ruleType: "standard_deviation" }),
    );
    expect(result.urgency).toBe("low");
    expect(result.message).toContain("low");
  });
});