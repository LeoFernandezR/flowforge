import type { StepExecutor } from "./types";
import { extractStep } from "./extract";
import { generateStep } from "./generate";

const stepRegistry: Record<string, StepExecutor> = {
  extract: extractStep,
  generate: generateStep,
};

export function getStepExecutor(taskType: string): StepExecutor {
  const step = stepRegistry[taskType];
  if (!step) {
    throw new Error(`Unknown task type: ${taskType}`);
  }
  return step;
}
