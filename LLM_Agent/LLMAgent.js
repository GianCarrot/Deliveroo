export class LLMAgent {
    constructor({ memory, planner, executor, replanner }) {
        this.memory = memory;
        this.planner = planner;
        this.executor = executor;
        this.replanner = replanner;

        this.plan = [];
        this.currentObjective = null;
        this.partnerId = null;
        this.partnerIntentions = new Set();
    }

    setPartnerId(id) {
        this.partnerId = id;
        console.log(`[LLM] Partner ID set to: ${id}`);
    }


    async setObjective(objectiveText) {
        this.currentObjective = objectiveText;
        this.memory.objective = objectiveText;

        this.memory.updateWorld();
        this.plan = await this.planner.plan(this.memory);
        console.log("Generated Plan:", this.plan);

        this.memory.history.push({
            type: "new_objective",
            objective: objectiveText,
            planLength: this.plan.length,
            timestamp: Date.now()
        });
    }

    async step() {
        if (!this.plan || this.plan.length === 0) return;

        const step = this.plan.shift();
        const tool = step.tool;
        const args = step.args || [];

        try {
            const result = await this.executor.execute(tool, ...args);

            this.memory.history.push({
                type: "action",
                tool,
                args,
                result,
                timestamp: Date.now(),
            });

            if (this.memory.hasWorldChanged()) {
                this.plan = await this.replanner.replan(this.memory, this.planner, "world_changed");
            }
        } catch (err) {
            this.memory.history.push({
                type: "action_error",
                tool,
                args,
                error: err.message,
                timestamp: Date.now(),
            });

            this.plan = await this.replanner.replan(this.memory, this.planner, "action_failed");
        }
    }
}