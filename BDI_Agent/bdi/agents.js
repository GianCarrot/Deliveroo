import { desires } from "./desires.js";
import { intentions } from "./intentions.js";

import { aStar } from "./pathfinding.js";

export class BDIAgent {
    constructor(socket, beliefs) {
        this.socket = socket;
        this.beliefs = beliefs;

        this.intention = null;   // { type: "...", target?, utility? }
        this.plan = [];          // [{ action: "move", dir }, ...]
    }

    // ---------- UTILITIES ----------

    manhattan(a, b) {
        return Math.abs(Math.round(a.x) - Math.round(b.x)) +
               Math.abs(Math.round(a.y) - Math.round(b.y));
    }

    getNearestParcel() {
        const me = this.beliefs.me;
        const parcels = this.beliefs.parcels || [];

        return parcels
            .filter(p => !p.carriedBy)
            .filter(p => this.beliefs.walkableTiles.has(`${Math.round(p.x)},${Math.round(p.y)}`))
            .sort((a, b) => {
                const d1 = this.manhattan(me, a);
                const d2 = this.manhattan(me, b);
                return d1 - d2;
            })[0];
    }

    getNearestDeliveryTile() {
        const me = this.beliefs.me;
        const deliveries = (this.beliefs.tiles || []).filter(t => t.type === "2");
        if (deliveries.length === 0) return null;

        return deliveries.sort((a, b) => {
            const d1 = this.manhattan(me, a);
            const d2 = this.manhattan(me, b);
            return d1 - d2;
        })[0];
    }

    pathToActions(path) {
        if (!path || path.length < 2) return [];

        const actions = [];
        for (let i = 0; i < path.length - 1; i++) {
            const cur = path[i];
            const next = path[i + 1];

            let dir = null;
            if (next.x > cur.x) dir = "right";
            else if (next.x < cur.x) dir = "left";
            else if (next.y > cur.y) dir = "up";
            else if (next.y < cur.y) dir = "down";

            if (dir) actions.push({ action: "move", dir });
        }
        return actions;
    }

    // ---------- DELIBERATION (UTILITY-BASED) ----------

    deliberate() {
        const me = this.beliefs.me;
        const parcels = this.beliefs.parcels || [];
        const candidates = [];

        for (const p of parcels) {
            if (p.carriedBy) continue;

            const reward = p.reward - (Date.now() - p.lastSeen) / 1000;

            const travelCost = this.manhattan(me, p);
            const nearestDelivery = this.getNearestDeliveryTile();
            const deliveryCost = nearestDelivery ? this.manhattan(p, nearestDelivery) : 0;

            const U = reward - (travelCost + deliveryCost);

            if (U > 0) {
                candidates.push({ type: "pickParcel", target: p, utility: U });
            }
        }

        if (this.beliefs.me.carrying > 0) {
            return { type: "deliverParcel" };
        }

        if (candidates.length === 0) {
            return { type: "wander" };
        }

        candidates.sort((a, b) => b.utility - a.utility);
        return candidates[0];
    }

    // ---------- PLANNER ----------

    async planFor(intention) {

        if (intention.type === "pickParcel") {
            const goal = intention.target;
            if (!goal) return [];
            const start = { x: this.beliefs.me.x, y: this.beliefs.me.y };
            const path = aStar(start, goal, this.beliefs);
            console.log("A* path (pickParcel):", path);
            return this.pathToActions(path);
        }

        if (intention.type === "deliverParcel") {
            const goal = this.getNearestDeliveryTile();
            if (!goal) return [];
            const start = { x: this.beliefs.me.x, y: this.beliefs.me.y };
            const path = aStar(start, goal, this.beliefs);
            console.log("A* path (deliverParcel):", path);
            return this.pathToActions(path);
        }

        if (intention.type === "wander") {
            const dirs = ["up", "down", "left", "right"];
            const dir = dirs[Math.floor(Math.random() * dirs.length)];
            return [ { action: "move", dir } ];
        }

        return [];
    }

    // ---------- PLAN EXECUTION ----------

    async executePlanStep() {
        if (!this.plan || this.plan.length === 0) return false;

        const step = this.plan.shift();

        if (step.action === "move") {
            const dir = step.dir;
            const oldX = this.beliefs.me.x;
            const oldY = this.beliefs.me.y;

            const ok = await this.socket.emitMove(dir);
            if (ok === false) {
                console.log("Movement failed (server returned false)");
                return false;
            }

            // opzionale: piccolo delay per permettere l’aggiornamento dei beliefs
            await new Promise(res => setTimeout(res, 80));

            const newX = this.beliefs.me.x;
            const newY = this.beliefs.me.y;

            if (Math.round(newX) === Math.round(oldX) &&
                Math.round(newY) === Math.round(oldY)) {
                console.log("Movement blocked (no position change)");
                return false;
            }

            return true;
        }

        return false;
    }

    // ---------- BDI CYCLE ----------

    async step() {
        // 1. Se ho un piano in corso, prova a eseguirlo
        if (this.intention && this.plan && this.plan.length > 0) {
            const success = await this.executePlanStep();
            if (success) return;

            console.log("Replanning triggered");
            this.intention = null;
            this.plan = [];
        }

        // 2. Se non ho intenzione → deliberazione
        if (!this.intention) {
            this.intention = this.deliberate();
            console.log("New intention:", this.intention);
        }

        // 3. Genera un piano per l’intenzione
        this.plan = await this.planFor(this.intention);

        // 4. Se il piano è vuoto → reset intenzione
        if (!this.plan || this.plan.length === 0) {
            console.log("No plan found for intention", this.intention);
            this.intention = null;
            return;
        }

        // 5. Esegui il primo step del piano
        await this.executePlanStep();
    }
}