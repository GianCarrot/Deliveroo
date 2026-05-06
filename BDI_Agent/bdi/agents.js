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

        // Path cache (to reduce A* call)
        this.lastGoalKey = null;
        this.cachedPath = null;
    }

    // ---------- UTILITIES ----------

    manhattan(a, b) {
        return Math.abs(Math.round(a.x) - Math.round(b.x)) +
            Math.abs(Math.round(a.y) - Math.round(b.y));
    }

    /**
     * Computes the utility of picking a parcel.
     * U = R_current - (Cost_travel + Cost_delivery)
     */

    computeParcelUtility(parcel) {
        const me = this.beliefs.me;
        const parcelPos = { x: Math.round(parcel.x), y: Math.round(parcel.y) };
        const myPos = { x: Math.round(me.x), y: Math.round(me.y) };

        const travelCost = this.manhattan(myPos, parcelPos);

        const nearestDelivery = this._nearestDeliveryFrom(parcelPos);
        const deliveryCost = nearestDelivery ? this.manhattan(parcelPos, nearestDelivery) : 0;

        const reward = parcel.reward;
        const U = reward - (travelCost + deliveryCost);
        return U;
    }

    _nearestDeliveryFrom(pos) {
        const deliveries = Array.from(this.beliefs.deliveryTiles).map(key => {
            const [x, y] = key.split(",").map(Number);
            return { x, y };
        });
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

    // ---------- REPLANNING CHECKS ----------

    shouldReplan() {
        if (!this.intention) return null;

        // Triggers 2 & 3: Target parcel stolen or Utility decay
        if (this.intention.type === "pickParcel" && this.intention.target) {
            const targetId = this.intention.target.id;

            const myPos = {
                x: Math.round(this.beliefs.me.x),
                y: Math.round(this.beliefs.me.y)
            };
            const targetPos = {
                x: Math.round(this.intention.target.x),
                y: Math.round(this.intention.target.y)
            };
            if (myPos.x === targetPos.x && myPos.y === targetPos.y) {
                return null;
            }

            const currentParcel = this.beliefs.parcels.find(p => p.id === targetId);

            if (!currentParcel || currentParcel.carriedBy) {
                return "target_stolen";
            }

            this.intention.target = currentParcel;

            const U = this.computeParcelUtility(currentParcel);
            if (U <= 0) {
                return "utility_decayed";
            }
        }

        // Trigger 4: Better opportunity
        if (this.intention.type === "pickParcel" && this.intention.utility !== undefined) {
            const TOLERANCE = 6; // più alto per ridurre oscillazioni
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

    // ---------- PLANNER (con caching) ----------

    async planFor(intention) {
        if (intention.type === "pickParcel") {
            const goal = intention.target;
            if (!goal) return [];

            const start = {
                x: Math.round(this.beliefs.me.x),
                y: Math.round(this.beliefs.me.y)
            };
            const goalRounded = {
                x: Math.round(goal.x),
                y: Math.round(goal.y)
            };
            const goalKey = `${goalRounded.x},${goalRounded.y}`;

            // Cache hit
            if (this.lastGoalKey === goalKey && this.cachedPath) {
                const actions = this.pathToActions(this.cachedPath);
                actions.push({ action: "pickup" });
                return actions;
            }

            // Cache miss → calcolo A*
            const path = aStar(start, goalRounded, this.beliefs);
            if (!path) {
                console.log("A* path (pickParcel): no path found");
                this.lastGoalKey = null;
                this.cachedPath = null;
                return [];
            }

            this.lastGoalKey = goalKey;
            this.cachedPath = path;

            const actions = this.pathToActions(path);
            actions.push({ action: "pickup" });
            return actions;
        }

        if (intention.type === "deliverParcel") {
            this.lastGoalKey = null;
            this.cachedPath = null;
        }

        if (intentions[intention.type]) {
            return await intentions[intention.type](this, intention);
        }
        return [];
    }

    // ---------- RETRY UTILITY ----------

    async _retryableCall(fn, label, maxAttempts = 3) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (e) {
                console.log(`${label} attempt ${attempt}/${maxAttempts} timed out`);
                if (attempt < maxAttempts) {
                    await new Promise(res => setTimeout(res, 200));
                }
            }
        }
        return undefined;
    }

    // ---------- PLAN EXECUTION ----------

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
                    await new Promise(res => setTimeout(res, 60));
                    const retryOk = await this.socket.emitMove(dir);
                    if (retryOk === false) {
                        console.log(`Move ${dir} failed after retry`);
                        return false;
                    }
                }
            } catch (e) {
                await new Promise(res => setTimeout(res, 80));
                const newX = Math.round(this.beliefs.me.x);
                const newY = Math.round(this.beliefs.me.y);
                if (newX === oldX && newY === oldY) {
                    try {
                        const retryOk = await this.socket.emitMove(dir);
                        if (retryOk === false) return false;
                    } catch (e2) {
                        await new Promise(res => setTimeout(res, 80));
                        const finalX = Math.round(this.beliefs.me.x);
                        const finalY = Math.round(this.beliefs.me.y);
                        if (finalX === oldX && finalY === oldY) {
                            console.log(`Move ${dir} failed completely`);
                            return false;
                        }
                    }
                }
            }
            return true;
        }

        if (step.action === "pickup") {
            await this._waitForPositionStable();

            const px = Math.round(this.beliefs.me.x);
            const py = Math.round(this.beliefs.me.y);
            const parcelHere = this.beliefs.parcels.find(
                p => Math.round(p.x) === px && Math.round(p.y) === py
            );

            if (!parcelHere) {
                console.log("Parcel disappeared before pickup");
                this.intention = null;
                return false;
            }

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

    async step() {
        if (this._stepping) return;
        this._stepping = true;

        const MAX_REPLANS = 5;
        let replanCount = 0;

        try {
            while (true) {
                if (!this.intention || !this.plan || this.plan.length === 0) {
                    this.intention = this.deliberate();
                    console.log(
                        "Intention:",
                        this.intention.type,
                        this.intention.target
                            ? `(${Math.round(this.intention.target.x)},${Math.round(this.intention.target.y)})`
                            : "",
                        "U=" + (this.intention.utility ?? "")
                    );

                    this.plan = await this.planFor(this.intention);
                    if (!this.plan || this.plan.length === 0) {
                        this.intention = null;
                        return;
                    }
                }

                while (this.plan && this.plan.length > 0) {
                    const nextStep = this.plan[0];

                    if (nextStep.action === "move") {
                        const replanReason = this.shouldReplan();
                        if (replanReason) {
                            replanCount++;
                            console.log(`Replanning: ${replanReason} (count=${replanCount})`);

                            if (replanCount > MAX_REPLANS) {
                                console.log("Too many replans, switching to wander");
                                this.intention = { type: "wander", utility: 0 };
                                this.plan = await this.planFor(this.intention);
                                break;
                            }

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

                // Wander: clear intention and re-deliberate immediately
                // (if a parcel appeared during the move, we'll switch to it)
                if (this.intention?.type === "wander") {
                    this.intention = null;
                    continue;
                }

                if (this.intention) break;
            }
        } catch (e) {
            console.error("Error in step():", e);
            this.intention = null;
            this.plan = [];
        } finally {
            this._stepping = false;
        }
    }

    async _waitForPositionStable() {
        let attempts = 0;
        while (attempts < 5) {
            const dx = Math.abs(this.beliefs.me.x - Math.round(this.beliefs.me.x));
            const dy = Math.abs(this.beliefs.me.y - Math.round(this.beliefs.me.y));
            if (dx < 0.05 && dy < 0.05) break;
            await new Promise(res => setTimeout(res, 15));
            attempts++;
        }
    }
}