/**
 * LLM Planner
 *
 * Implements the ReAct-style perception-action loop (runAgentTurn).
 * The LLM receives the world context + objective, outputs Thought/Action/Action Input,
 * we execute the tool and feed back the Observation, and loop until Final Answer
 * or maxIterations is reached.
 *
 * Resilience: on parse failures or errors, the planner retries with a nudge
 * instead of giving up.
 */
import { callModel } from "./callModel.js";
import { AGENT_PROMPT } from "./prompts/agentPrompt.js";

export class LLMPlanner {
    constructor({ maxIterations = 15 } = {}) {
        this.maxIterations = maxIterations;
        this.abortCurrentTurn = false;
    }

    /**
     * ReAct execution loop — directly from runAgentTurn().
     *
     * @param {import('./LLMMemory.js').LLMMemory} memory
     * @param {import('./LLMExecutor.js').LLMExecutor} executor
     * @returns {Promise<string>} final answer or last observation
     */
    async runAgentTurn(memory, executor) {
        const worldContext = memory.buildContext();

        const userInput = `
            Current world state:
            ${worldContext}

            Your objective: ${memory.objective}

            Decide what to do next.`;

        let messages = [
            { role: "system", content: AGENT_PROMPT },
            { role: "user", content: userInput },
        ];

        let consecutiveErrors = 0;

        for (let i = 0; i < this.maxIterations; i++) {
            if (this.abortCurrentTurn) {
                this.abortCurrentTurn = false;
                console.warn("[LLM] Turn aborted by a new NL objective.");
                return "Turn aborted for new objective";
            }

            let response;
            try {
                response = await callModel(messages);
            } catch (e) {
                console.error(`[LLM] callModel threw:`, e.message);
                consecutiveErrors++;
                if (consecutiveErrors >= 3) {
                    console.error("[LLM] Too many consecutive API errors, ending turn");
                    return "API errors — will retry next turn";
                }
                // Wait briefly and retry
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            console.log(`[LLM] Turn ${i + 1}:`, response.substring(0, 200));

            // API error response — retry with nudge
            if (response.startsWith("Error:")) {
                consecutiveErrors++;
                if (consecutiveErrors >= 3) {
                    console.error("[LLM] Too many API errors, ending turn");
                    return "API errors — will retry next turn";
                }
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            consecutiveErrors = 0; // reset on success
            messages.push({ role: "assistant", content: response });

            // Parse: Action + Action Input
            const actionMatch = response.match(/^Action:\s*(.+)$/im);
            const actionInputMatch = response.match(/^Action Input:\s*(.+)$/im);

            if (actionMatch) {
                const action = actionMatch[1].trim();
                const actionInput = actionInputMatch
                    ? actionInputMatch[1].trim()
                    : "none";

                console.log(`[LLM] Executing: ${action}(${actionInput})`);

                let observation;
                try {
                    observation = await executor.execute(action, actionInput);
                } catch (e) {
                    observation = `Error executing ${action}: ${e.message}`;
                }

                console.log(`[LLM] Observation: ${observation.substring(0, 150)}`);

                // Record in memory
                memory.history.push({
                    type: "action",
                    tool: action,
                    args: actionInput,
                    result: observation,
                    timestamp: Date.now(),
                });

                // Feed observation back to LLM
                messages.push({
                    role: "user",
                    content: `Observation: ${observation}`,
                });
                continue;
            }

            // Parse: Final Answer
            const finalAnswerMatch = response.match(
                /^Final Answer:\s*([\s\S]*)$/im
            );
            if (finalAnswerMatch) {
                const answer = finalAnswerMatch[1].trim();
                console.log(`[LLM] Final Answer: ${answer}`);
                return answer;
            }

            // Unexpected format — nudge the LLM to retry
            console.warn("[LLM] Unexpected format, nudging LLM to use correct format");
            messages.push({
                role: "user",
                content:
                    "Your response did not follow the required format. " +
                    "Please respond with EXACTLY one of:\n" +
                    "1) Thought: ... / Action: ... / Action Input: ...\n" +
                    "2) Thought: ... / Final Answer: ...\n" +
                    "Try again based on the current situation.",
            });
            // Don't return — let it retry
        }

        console.warn("[LLM] Max iterations reached — turn will continue next cycle");
        return "Max iterations reached — continuing next cycle";
    }
}