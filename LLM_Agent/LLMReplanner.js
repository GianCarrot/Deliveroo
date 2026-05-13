export class LLMReplanner {
  constructor() {}

  async replan(memory, planner) {
    // 1. Aggiorna lo stato del mondo nella memoria
    memory.updateWorld(memory.bdi.beliefs);

    // 2. Logga nella history
    memory.history.push({
      type: "replan",
      reason: "world_changed_or_action_failed",
      timestamp: Date.now()
    });

    // 3. Chiedi un nuovo piano all’LLM Planner
    const newPlan = await planner.plan(memory);

    // 4. Restituisci il nuovo piano
    return newPlan;
  }
}