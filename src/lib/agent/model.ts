/**
 * The model layer, kept behind a small interface so run.ts can be tested without the network.
 * The default implementation uses the Vercel AI SDK with Anthropic (claude-sonnet-5-5, override with SOUNDCHECK_MODEL).
 * Notes for Sonnet 5.5: no temperature (non-default sampling params are rejected) and no forced tool_choice; the loop
 * uses toolChoice "auto" and steers from the prompt, and structured output goes through Output.object (native format).
 */
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, isStepCount, Output, tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AgentToolSpec } from "./tools";
import { COPY_INSTRUCTIONS, WITHOUT_QLOO_INSTRUCTIONS } from "./prompts";

export const DEFAULT_MODEL_ID = "claude-sonnet-5-5";

export const StopCopy = z.object({
  suggestion: z.string().min(1).max(200),
  whyHere: z.string().min(1).max(320),
});
export type StopCopy = z.infer<typeof StopCopy>;

export const WithoutQloo = z.object({
  cities: z.array(z.string()).max(20),
  openers: z.array(z.string()).max(10),
  note: z.string().max(600),
});
export type WithoutQloo = z.infer<typeof WithoutQloo>;

export interface AgentLoopResult {
  steps: number;
  toolCalls: number;
  text: string;
}

export interface AgentModel {
  readonly id: string;
  /** Run the tool-calling loop until the model stops, maxSteps is hit, or the signal aborts. */
  runAgent(opts: {
    instructions: string;
    prompt: string;
    tools: AgentToolSpec[];
    maxSteps: number;
    signal?: AbortSignal;
  }): Promise<AgentLoopResult>;
  /** Phrase one stop's suggestion and whyHere from the given facts. */
  writeStopCopy(facts: Record<string, unknown>, signal?: AbortSignal): Promise<StopCopy>;
  /** Plain-LLM plan for the "Without Qloo" toggle. */
  planWithoutQloo(prompt: string, signal?: AbortSignal): Promise<WithoutQloo>;
}

function toToolSet(specs: AgentToolSpec[]): ToolSet {
  const set: ToolSet = {};
  for (const spec of specs) {
    set[spec.name] = tool({
      description: spec.description,
      inputSchema: spec.input,
      execute: async (input: unknown) => spec.run(input),
    });
  }
  return set;
}

export function createAnthropicModel(modelId: string = process.env.SOUNDCHECK_MODEL || DEFAULT_MODEL_ID): AgentModel {
  const model = anthropic(modelId);
  return {
    id: modelId,
    async runAgent({ instructions, prompt, tools, maxSteps, signal }) {
      const result = await generateText({
        model,
        instructions,
        prompt,
        tools: toToolSet(tools),
        toolChoice: "auto",
        stopWhen: isStepCount(maxSteps),
        abortSignal: signal,
        maxRetries: 2,
        providerOptions: { anthropic: { effort: "medium" } },
      });
      const toolCalls = result.steps.reduce((n, s) => n + s.toolCalls.length, 0);
      return { steps: result.steps.length, toolCalls, text: result.text };
    },
    async writeStopCopy(facts, signal) {
      const { output } = await generateText({
        model,
        instructions: COPY_INSTRUCTIONS,
        prompt: JSON.stringify(facts),
        output: Output.object({ schema: StopCopy }),
        abortSignal: signal,
        maxRetries: 1,
        providerOptions: { anthropic: { effort: "low" } },
      });
      return StopCopy.parse(output);
    },
    async planWithoutQloo(prompt, signal) {
      const { output } = await generateText({
        model,
        instructions: WITHOUT_QLOO_INSTRUCTIONS,
        prompt,
        output: Output.object({ schema: WithoutQloo }),
        abortSignal: signal,
        maxRetries: 1,
        providerOptions: { anthropic: { effort: "low" } },
      });
      return WithoutQloo.parse(output);
    },
  };
}
