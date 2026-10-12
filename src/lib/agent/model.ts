/**
 * The model layer, kept behind a small interface so run.ts can be tested without the network.
 * The default implementation uses the Vercel AI SDK with Anthropic (claude-sonnet-5-5, override with SOUNDCHECK_MODEL).
 * Notes for Sonnet 5.5: no temperature (non-default sampling params are rejected) and no forced tool_choice; the loop
 * uses toolChoice "auto" and steers from the prompt, and structured output goes through Output.object (native format).
 */
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, isStepCount, Output, tool, type LanguageModelUsage, type ToolSet } from "ai";
import { z } from "zod";
import type { ModelUsage } from "@/lib/types";
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

/** Accumulates usage across the calls of one run. Created per run, so concurrent runs never mix. */
export class UsageMeter {
  readonly usage: ModelUsage;
  constructor(id: string, promptCache: boolean) {
    this.usage = { id, calls: 0, steps: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, promptCache };
  }
  add(u: LanguageModelUsage | undefined, steps = 1) {
    this.usage.calls++;
    this.usage.steps += steps;
    if (!u) return;
    this.usage.inputTokens += u.inputTokens ?? 0;
    this.usage.cacheReadTokens += u.inputTokenDetails?.cacheReadTokens ?? 0;
    this.usage.cacheWriteTokens += u.inputTokenDetails?.cacheWriteTokens ?? 0;
    this.usage.outputTokens += u.outputTokens ?? 0;
  }
}

/** Prompt caching is on unless SOUNDCHECK_PROMPT_CACHE=0 (kept switchable to measure the difference). */
export function promptCacheEnabled(): boolean {
  return process.env.SOUNDCHECK_PROMPT_CACHE !== "0";
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
    meter?: UsageMeter;
  }): Promise<AgentLoopResult>;
  /** Phrase one stop's suggestion and whyHere from the given facts. */
  writeStopCopy(facts: Record<string, unknown>, signal?: AbortSignal, meter?: UsageMeter): Promise<StopCopy>;
  /** Plain-LLM plan for the "Without Qloo" toggle. */
  planWithoutQloo(prompt: string, signal?: AbortSignal, meter?: UsageMeter): Promise<WithoutQloo>;
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
  // A top-level cache_control turns on Anthropic's automatic prompt caching: the API caches the longest reusable prefix
  // (instructions, tool schemas, earlier turns) on every call, so a 20-step tool loop re-reads its history at the
  // cached rate instead of paying full price for it on every step.
  const cache = promptCacheEnabled() ? { cacheControl: { type: "ephemeral" as const } } : {};
  return {
    id: modelId,
    async runAgent({ instructions, prompt, tools, maxSteps, signal, meter }) {
      const result = await generateText({
        model,
        instructions,
        prompt,
        tools: toToolSet(tools),
        toolChoice: "auto",
        stopWhen: isStepCount(maxSteps),
        abortSignal: signal,
        maxRetries: 2,
        providerOptions: { anthropic: { effort: "medium", ...cache } },
      });
      meter?.add(result.totalUsage, result.steps.length);
      const toolCalls = result.steps.reduce((n, s) => n + s.toolCalls.length, 0);
      return { steps: result.steps.length, toolCalls, text: result.text };
    },
    async writeStopCopy(facts, signal, meter) {
      const result = await generateText({
        model,
        instructions: COPY_INSTRUCTIONS,
        prompt: JSON.stringify(facts),
        output: Output.object({ schema: StopCopy }),
        abortSignal: signal,
        maxRetries: 1,
        providerOptions: { anthropic: { effort: "low", ...cache } },
      });
      meter?.add(result.totalUsage);
      return StopCopy.parse(result.output);
    },
    async planWithoutQloo(prompt, signal, meter) {
      const result = await generateText({
        model,
        instructions: WITHOUT_QLOO_INSTRUCTIONS,
        prompt,
        output: Output.object({ schema: WithoutQloo }),
        abortSignal: signal,
        maxRetries: 1,
        providerOptions: { anthropic: { effort: "low", ...cache } },
      });
      meter?.add(result.totalUsage);
      return WithoutQloo.parse(result.output);
    },
  };
}
