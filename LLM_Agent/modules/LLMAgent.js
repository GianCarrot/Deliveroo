/**
 * LLMAgent — top-level orchestrator.
 *
 * Wires together Memory, Planner (ReAct loop), Executor (TOOLS), and Replanner.
 * The agent is NEVER idle when it has an objective — it continuously runs
 * ReAct turns, replanning automatically on errors, world changes, or
 * completion of a previous turn.
 */
export class LLMAgent {
    /**
     * @param {object} deps
     * @param {import('./LLMMemory.js').LLMMemory} deps.memory
     * @param {import('./LLMPlanner.js').LLMPlanner} deps.planner
     * @param {import('./LLMExecutor.js').LLMExecutor} deps.executor
     * @param {import('./LLMReplanner.js').LLMReplanner} deps.replanner
     */
    constructor({ memory, planner, executor, replanner }) {
        this.memory = memory;
        this.planner = planner;
        this.executor = executor;
        this.replanner = replanner;

        this.currentObjective = null;
        this.defaultObjective = null;
        this.partnerId = null;
        this.partnerIntentions = new Set();
        this._busy = false;  // guard against overlapping turns

        /** Cooldown: minimum ms between consecutive turns to avoid API hammering */
        this._lastTurnEnd = 0;
        this._turnCooldownMs = 100;
    }

    setPartnerId(id) {
        this.partnerId = id;
        console.log(`[LLM] Partner ID set to: ${id}`);
    }

    setDefaultObjective(objectiveText) {
        this.defaultObjective = objectiveText;
        if (!this.currentObjective) {
            this.setObjective(objectiveText);
        }
    }

    async resumeDefaultObjective() {
        if (this.defaultObjective && this.currentObjective !== this.defaultObjective) {
            console.log("[LLM] Mission complete: resuming default autonomous objective");
            await this.setObjective(this.defaultObjective);
        }
    }

    /**
     * Receive a new NL objective and immediately
     * run the ReAct planning loop.
     * @param {string} objectiveText
     */
    async setObjective(objectiveText) {
        this.currentObjective = objectiveText;
        this.memory.objective = objectiveText;
        this.memory.updateWorld();

        this.memory.history.push({
            type: "new_objective",
            objective: objectiveText,
            timestamp: Date.now(),
        });

        console.log(`[LLM] New objective: "${objectiveText}"`);

        // If currently in a turn, signal it to abort so the new objective is picked up
        if (this._busy) {
            console.log(`[LLM] Aborting current turn to focus on new objective...`);
            this.planner.abortCurrentTurn = true;
        }

        // Force a new turn immediately (bypass cooldown for new objectives)
        this._lastTurnEnd = 0;
        await this._runTurn();
    }

    /**
     * Called every sensing tick.
     * The agent is ALWAYS willing to act — it doesn't wait for world changes.
     * A short cooldown prevents API hammering between turns.
     */
    async step() {
        if (this._busy) return;
        if (!this.currentObjective) return;

        // Cooldown between turns to avoid hammering the LLM API
        const elapsed = Date.now() - this._lastTurnEnd;
        if (elapsed < this._turnCooldownMs) return;

        // Always start a new turn — the agent should be continuously acting
        await this._runTurn();
    }

    // Private helpers

    async _runTurn() {
        if (this._busy) return;
        this._busy = true;
        try {
            this.memory.updateWorld();
            const result = await this.planner.runAgentTurn(this.memory, this.executor);
            this.memory.updateWorld(); // snapshot after turn

            // Log the turn result for debugging
            if (result) {
                console.log(`[LLM] Turn completed: ${result.substring(0, 100)}`);
            }

            // Replanner check
            // If the world changed significantly during this turn,
            // immediately replan with fresh context
            if (this.replanner.shouldReplan(this.memory)) {
                console.log("[LLM] World changed during turn → replanning...");
                const replanResult = await this.replanner.replan(
                    this.memory, this.planner, this.executor, "world_changed"
                );
                if (replanResult) {
                    console.log(`[LLM] Replan result: ${replanResult.substring(0, 100)}`);
                }
            }
        } catch (err) {
            console.error("[LLM] Turn error:", err.message);
            this.memory.history.push({
                type: "action_error",
                error: err.message,
                timestamp: Date.now(),
            });
        } finally {
            this._busy = false;
            this._lastTurnEnd = Date.now();

            // Auto-schedule the next turn so the agent NEVER relies solely 
            // on 'sensing' events (which stop arriving if nothing moves).
            setTimeout(() => this.step(), this._turnCooldownMs);
        }
    }
}