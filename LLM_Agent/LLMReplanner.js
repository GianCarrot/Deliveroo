export class LLMReplanner {
    constructor() {}

    async replan(memory, planner, reason = "unknown") {
        memory.updateWorld();

        memory.history.push({
            type: "replan",
            reason,
            timestamp: Date.now(),
        });

        return await planner.plan(memory);
    }
}