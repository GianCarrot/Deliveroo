export class LLMReplanner {
  constructor() { }

  async replan(memory, planner) {
    // 1. Update world state in memory
    memory.updateWorld(memory.bdi.beliefs);

    // 2. Log in history
    memory.history.push({
      type: "replan",
      reason: "world_changed_or_action_failed",
      timestamp: Date.now()
    });

    // 3. Ask for a new plan to the LLM Planner
    const newPlan = await planner.plan(memory);

    // 4. Return the new plan
    return newPlan;
  }
}