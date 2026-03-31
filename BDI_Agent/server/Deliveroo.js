import express from "express";

class Deliveroo {
    constructor() {
        this.beliefs = {};
        this.desires = [];
        this.intentions = [];
        this.plans = {};
    }

    // Update beliefs
    updateBeliefs(key, value) {
        this.beliefs[key] = value;
    }

    // Update desires
    addDesire(desire) {
        this.desires.push(desire);
    }

    // Deliberate
    deliberate() {
        return this.desires.filter(d => d.condition(this.beliefs));
    }

    // Filtering of Intentions
    filterIntentions(relevant) {
        this.intentions = relevant.map(d => d.name);
    }

    // Update plans
    addPlans(desireName, planFn) {
        this.plans[desireName] = planFn
    }

    //Execute of Intentions
    async execute() {
        for (const intention of this.intentions) {
            const plan = this.plans[intention];
            if (plan) {
                console.log("Exec:", intention);
                await plan(this.beliefs);
            }
        }
    }

    async step() {
        const relevant = this.deliberate();
        this.filterIntentions(relevant);
        await this.execute();
    }
}