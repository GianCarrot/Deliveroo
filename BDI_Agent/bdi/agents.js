import { getDesires } from "./desires.js";
import { intentions } from "./intentions.js";

import { aStar } from "./pathfinding.js";

export class BDIAgent {
    constructor(socket, beliefs) {
        this.socket = socket;
        this.beliefs = beliefs;

        this.intention = null;   // { type: "...", target?, utility? }
        this.plan = [];          // [{ action: "move", dir }, ...]
        this._stepping = false;  // Mutex to prevent concurrent step() calls
    }

    // ---------- UTILITIES ----------

    manhattan(a, b) {
        return Math.abs(Math.round(a.x) - Math.round(b.x)) +
            Math.abs(Math.round(a.y) - Math.round(b.y));
    }

    /**
     * Computes the utility of picking a parcel using A* real path cost.
     * Returns the utility value, or -Infinity if no path exists.
     */
    computeParcelUtility(parcel) {
        const me = this.beliefs.me;
        const parcelPos = { x: Math.round(parcel.x), y: Math.round(parcel.y) };
        const myPos = { x: Math.round(me.x), y: Math.round(me.y) };

        // Use Manhattan distance for fast estimation (Cost_travel)
        const travelCost = this.manhattan(myPos, parcelPos);

        // Find nearest delivery from the parcel position (Cost_delivery)
        const nearestDelivery = this._nearestDeliveryFrom(parcelPos);
        const deliveryCost = nearestDelivery ? this.manhattan(parcelPos, nearestDelivery) : 0;

        const reward = parcel.reward;
        const U = reward - (travelCost + deliveryCost);
        return U;
    }

    /**
     * Returns the nearest delivery tile from a given position.
     */
    _nearestDeliveryFrom(pos) {
        const deliveries = (this.beliefs.tiles || []).filter(t => String(t.type) === "2");
        if (deliveries.length === 0) return null;

        return deliveries.sort((a, b) => {
            const d1 = this.manhattan(pos, a);
            const d2 = this.manhattan(pos, b);
            return d1 - d2;
        })[0];
    }

    getNearestDeliveryTile() {
        return this._nearestDeliveryFrom(this.beliefs.me);
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
        const candidates = getDesires(this);
        if (candidates.length === 0) return { type: "wander", utility: 0 };
        candidates.sort((a, b) => b.utility - a.utility);
        return candidates[0];
    }

    // ---------- REPLANNING CHECKS (REQUIREMENTS §5) ----------

    /**
     * Checks if the current intention should be abandoned.
     * Returns a reason string if replanning is needed, or null to continue.
     */
    shouldReplan() {
        if (!this.intention) return null;

        // Triggers 2 & 3: Target parcel stolen or Utility decay
        if (this.intention.type === "pickParcel" && this.intention.target) {
            const targetId = this.intention.target.id;

            // If the agent is already on the target cell, never replan — just pick up
            const myPos = { x: Math.round(this.beliefs.me.x), y: Math.round(this.beliefs.me.y) };
            const targetPos = { x: Math.round(this.intention.target.x), y: Math.round(this.intention.target.y) };
            if (myPos.x === targetPos.x && myPos.y === targetPos.y) {
                return null;
            }

            const currentParcel = this.beliefs.parcels.find(p => p.id === targetId);

            if (!currentParcel || currentParcel.carriedBy) {
                return "target_stolen";
            }

            // Update snapshot so Trigger 3 and 4 use current decayed reward
            this.intention.target = currentParcel;

            const U = this.computeParcelUtility(currentParcel);
            if (U <= 0) {
                return "utility_decayed";
            }
        }

        // Trigger 4: Better opportunity — new parcel with significantly higher U
        if (this.intention.type === "pickParcel" && this.intention.utility !== undefined) {
            const TOLERANCE = 2; // Threshold to avoid oscillation
            const currentU = this.computeParcelUtility(this.intention.target);
            const parcels = this.beliefs.parcels || [];

            for (const p of parcels) {
                if (p.carriedBy) continue;
                if (p.id === this.intention.target?.id) continue;
                const newU = this.computeParcelUtility(p);
                if (newU > currentU + TOLERANCE) {
                    return "better_opportunity";
                }
            }
        }

        return null;
    }

    // ---------- PLANNER ----------

    async planFor(intention) {
        if (intentions[intention.type]) {
            return await intentions[intention.type](this, intention);
        }
        return [];
    }

    /**
     * Plans a wander action towards a random walkable neighbor.
     * Falls back to a random direction if no walkable neighbor is found.
     */
    _planWander() {
        const x = Math.round(this.beliefs.me.x);
        const y = Math.round(this.beliefs.me.y);

        // Check the current tile type — if arrow, must go that direction
        const tileType = this.beliefs.getTileType(x, y);
        const arrowDirs = { '↑': 'up', '↓': 'down', '→': 'right', '←': 'left' };
        if (tileType && arrowDirs[tileType]) {
            return [{ action: "move", dir: arrowDirs[tileType] }];
        }

        // Otherwise, pick a random direction that leads to a walkable tile
        const dirMap = [
            { dir: "up", dx: 0, dy: 1 },
            { dir: "down", dx: 0, dy: -1 },
            { dir: "left", dx: -1, dy: 0 },
            { dir: "right", dx: 1, dy: 0 },
        ];

        const walkable = dirMap.filter(({ dx, dy }) => {
            const nk = `${x + dx},${y + dy}`;
            const isWalkable = this.beliefs.walkableTiles.has(nk);
            // Check dynamic obstacles
            const hasAgent = Array.from(this.beliefs.agentsMap.values()).some(
                a => Math.round(a.x) === (x + dx) && Math.round(a.y) === (y + dy)
            );
            return isWalkable && !hasAgent;
        });

        if (walkable.length === 0) {
            // Surrounded — try random as last resort
            const dir = dirMap[Math.floor(Math.random() * dirMap.length)].dir;
            return [{ action: "move", dir }];
        }

        const choice = walkable[Math.floor(Math.random() * walkable.length)];
        return [{ action: "move", dir: choice.dir }];
    }

    // ---------- PLAN EXECUTION ----------

    /**
     * Safely calls an async SDK method with retry logic for timeouts.
     */
    async _retryableCall(fn, label, maxAttempts = 3) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (e) {
                console.log(`${label} attempt ${attempt}/${maxAttempts} timed out`);
                if (attempt < maxAttempts) {
                    await new Promise(res => setTimeout(res, 300));
                }
            }
        }
        return undefined; // all attempts failed
    }

    async executePlanStep() {
        if (!this.plan || this.plan.length === 0) return false;

        const step = this.plan.shift();

        if (step.action === "move") {
            const dir = step.dir;
            const oldX = Math.round(this.beliefs.me.x);
            const oldY = Math.round(this.beliefs.me.y);

            try {
                const ok = await this.socket.emitMove(dir);
                if (ok === false) {
                    // Trigger 1 (REQUIREMENTS §5): retry once after delay
                    await new Promise(res => setTimeout(res, 200));
                    const retryOk = await this.socket.emitMove(dir);
                    if (retryOk === false) {
                        console.log(`Move ${dir} failed after retry`);
                        return false;
                    }
                }
            } catch (e) {
                // Timeout — wait briefly and check if position actually changed
                await new Promise(res => setTimeout(res, 100));
                const newX = Math.round(this.beliefs.me.x);
                const newY = Math.round(this.beliefs.me.y);
                if (newX === oldX && newY === oldY) {
                    // Position unchanged — retry once
                    try {
                        const retryOk = await this.socket.emitMove(dir);
                        if (retryOk === false) return false;
                    } catch (e2) {
                        await new Promise(res => setTimeout(res, 100));
                        const finalX = Math.round(this.beliefs.me.x);
                        const finalY = Math.round(this.beliefs.me.y);
                        if (finalX === oldX && finalY === oldY) {
                            console.log(`Move ${dir} failed completely`);
                            return false;
                        }
                    }
                }
                // Position changed — move succeeded despite timeout
            }
            return true;
        }

        if (step.action === "pickup") {
            await this._waitForPositionStable();
            const result = await this._retryableCall(
                () => this.socket.emitPickup(), "Pickup"
            );
            if (Array.isArray(result) && result.length > 0) {
                this.beliefs.addCarriedParcels(result);
                console.log(`Picked up ${result.length} parcels`);
            } else {
                console.log("Pickup returned nothing (parcel may have been taken)");
            }
            this.intention = null;
            return true;
        }

        if (step.action === "putdown") {
            await this._waitForPositionStable();
            // CRITICAL: verify we are on a delivery tile before putdown
            const px = Math.round(this.beliefs.me.x);
            const py = Math.round(this.beliefs.me.y);
            if (!this.beliefs.deliveryTiles.has(`${px},${py}`)) {
                console.log(`NOT on delivery tile (${px},${py}), aborting putdown`);
                this.intention = null;
                return false;
            }
            const result = await this._retryableCall(
                () => this.socket.emitPutdown(), "Putdown"
            );
            if (Array.isArray(result) && result.length > 0) {
                console.log(`Put down ${result.length} parcels at (${px},${py})`);
            } else {
                console.log("Putdown returned nothing");
            }
            this.beliefs.clearCarriedParcels();
            this.intention = null;
            return true;
        }

        return false;
    }

    // ---------- BDI CYCLE ----------

    /**
     * Executes the full BDI cycle: deliberate → plan → execute ALL steps.
     * Runs the entire plan in one call for speed, checking replan triggers between moves.
     */
    async step() {
        if (this._stepping) return;
        this._stepping = true;

        try {
            // Outer loop: after pickup/putdown, immediately re-deliberate & execute
            while (true) {
                // 1. Deliberate if no current intention/plan
                if (!this.intention || !this.plan || this.plan.length === 0) {
                    this.intention = this.deliberate();
                    console.log("Intention:", this.intention.type,
                        this.intention.target ? `(${this.intention.target.x},${this.intention.target.y})` : '',
                        'U=' + (this.intention.utility ?? ''));

                    this.plan = await this.planFor(this.intention);
                    if (!this.plan || this.plan.length === 0) {
                        this.intention = null;
                        return;
                    }
                }

                // 2. Execute the FULL plan
                while (this.plan && this.plan.length > 0) {
                    const nextStep = this.plan[0];

                    if (nextStep.action === "move") {
                        const replanReason = this.shouldReplan();
                        if (replanReason) {
                            console.log(`Replanning: ${replanReason}`);
                            this.intention = null;
                            this.plan = [];
                            break;
                        }
                    }

                    const success = await this.executePlanStep();
                    if (!success) {
                        this.intention = null;
                        this.plan = [];
                        break;
                    }

                    if (!this.intention) break;
                }

                // Wander: execute once and stop
                if (this.intention?.type === "wander") {
                    this.intention = null;
                    break;
                }

                // If intention still set (replan needed), loop back
                // If intention cleared by pickup/putdown, loop back to re-deliberate
                if (this.intention) break; // plan finished normally or was interrupted
                // else: intention was cleared → re-deliberate immediately
            }
        } catch (e) {
            console.error("Error in step():", e);
            // Clear intention on error so the BDI cycle restarts
            this.intention = null;
            this.plan = [];
        } finally {
            this._stepping = false;
        }
    }

    /**
     * Waits until the agent's fractional position stabilizes to an integer grid coordinate.
     */
    async _waitForPositionStable() {
        let attempts = 0;
        while (attempts < 10) {
            const dx = Math.abs(this.beliefs.me.x - Math.round(this.beliefs.me.x));
            const dy = Math.abs(this.beliefs.me.y - Math.round(this.beliefs.me.y));
            if (dx < 0.05 && dy < 0.05) break;
            await new Promise(res => setTimeout(res, 50));
            attempts++;
        }
    }
}