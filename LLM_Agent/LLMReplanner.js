/**
 * LLM Replanner
 *
 * Monitors execution; triggers re-planning if the environment changes
 * or the objective is updated. Uses ReAct / Reflexion reasoning
 * by injecting the reason into the memory context so the next
 * runAgentTurn iteration is aware of what went wrong.
 */
export class LLMReplanner {
    constructor() { }

    /**
     * Checks whether replanning is needed.
     * @param {import('./LLMMemory.js').LLMMemory} memory
     * @returns {boolean}
     */
    shouldReplan(memory) {
        return memory.hasWorldChanged();
    }

    /**
     * Triggers a replan by updating memory and delegating to the planner.
     * @param {import('./LLMMemory.js').LLMMemory} memory
     * @param {import('./LLMPlanner.js').LLMPlanner} planner
     * @param {import('./LLMExecutor.js').LLMExecutor} executor
     * @param {string} reason — why we are replanning (e.g. "world_changed", "action_failed")
     * @returns {Promise<string>}
     */
    async replan(memory, planner, executor, reason = "unknown") {
        console.log(`[LLM] Replanning — reason: ${reason}`);

        memory.updateWorld();

        memory.history.push({
            type: "replan",
            reason,
            timestamp: Date.now(),
        });

        // Re-run the full ReAct turn with updated world state
        return await planner.runAgentTurn(memory, executor);
    }
}