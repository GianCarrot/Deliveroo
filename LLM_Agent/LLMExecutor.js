/**
 * TOOLS dict — §5 + §8 of GUIDE-PART-2.
 *
 * Maps LLM action names directly to Deliveroo SDK calls.
 * Includes the PDDL plan_route tool (§8) and partner-intention query (§6).
 */
import { aStar } from "../shared/pathfinding.js";

export class LLMExecutor {
    /**
     * @param {object} socket  — connected Deliveroo socket
     * @param {import('../BDI_Agent/bdi/beliefs.js').Beliefs} beliefs
     * @param {LLMAgent} agent  — back-reference for partner intentions
     */
    constructor(socket, beliefs, agent = null) {
        this.socket = socket;
        this.beliefs = beliefs;
        this.agent = agent;

        // ─── TOOLS dict (§5) ──────────────────────────────────
        this.TOOLS = {
            get_my_position: async () => {
                return JSON.stringify({
                    x: this.beliefs.me.x,
                    y: this.beliefs.me.y,
                    score: this.beliefs.me.score,
                    carrying: this.beliefs.carriedParcels.length,
                });
            },

            move: async (direction) => {
                try {
                    const result = await this.socket.emitMove(direction);
                    return result !== false
                        ? `Successfully moved ${direction}`
                        : `Failed to move ${direction}`;
                } catch (e) {
                    return `Error: ${e.message}`;
                }
            },

            pick_up: async () => {
                try {
                    const result = await this.socket.emitPickup();
                    if (Array.isArray(result) && result.length > 0) {
                        this.beliefs.addCarriedParcels(result);
                        return `Picked up ${result.length} parcel(s)`;
                    }
                    return "Failed to pick up – no parcels on this tile";
                } catch (e) {
                    return `Error: ${e.message}`;
                }
            },

            put_down: async () => {
                try {
                    const result = await this.socket.emitPutdown();
                    if (Array.isArray(result) && result.length > 0) {
                        this.beliefs.clearCarriedParcels();
                        return `Delivered ${result.length} parcel(s) successfully`;
                    }
                    return "Failed to put down – not on a delivery tile or no parcels carried";
                } catch (e) {
                    return `Error: ${e.message}`;
                }
            },

            /**
             * Fast local pathfinding (A*) — used for standard autonomous navigation.
             * Executes the movement automatically.
             */
            plan_route: async (input) => {
                try {
                    let targetX, targetY;

                    if (typeof input === "string") {
                        const nums = input.match(/-?\d+/g);
                        if (!nums || nums.length < 2) return "Error: provide target as 'x,y'";
                        targetX = parseInt(nums[0]);
                        targetY = parseInt(nums[1]);
                    } else if (typeof input === "object") {
                        targetX = input.x ?? input.target_x;
                        targetY = input.y ?? input.target_y;
                    }

                    if (targetX == null || targetY == null) {
                        return "Error: could not parse target position";
                    }

                    // Always use fast A* for standard navigation
                    return await this._moveToAStar(targetX, targetY);
                } catch (e) {
                    return `Error in plan_route: ${e.message}`;
                }
            },

            /**
             * Online PDDL solver — used ONLY for complex user instructions.
             * Slower, but capable of complex logical planning.
             */
            pddl_plan_route: async (input) => {
                try {
                    let targetX, targetY;

                    if (typeof input === "string") {
                        const nums = input.match(/-?\d+/g);
                        if (!nums || nums.length < 2) return "Error: provide target as 'x,y'";
                        targetX = parseInt(nums[0]);
                        targetY = parseInt(nums[1]);
                    } else if (typeof input === "object") {
                        targetX = input.x ?? input.target_x;
                        targetY = input.y ?? input.target_y;
                    }

                    if (targetX == null || targetY == null) {
                        return "Error: could not parse target position";
                    }

                    const pddlResult = await this._tryPddlSolve(targetX, targetY);
                    if (pddlResult) return pddlResult;

                    // Fallback if PDDL fails
                    return await this._moveToAStar(targetX, targetY);
                } catch (e) {
                    return `Error in pddl_plan_route: ${e.message}`;
                }
            },

            /**
             * Returns known uncollected parcels (from beliefs).
             */
            get_known_parcels: async () => {
                const parcels = this.beliefs.parcels.filter(
                    (p) => !p.carriedBy
                );
                if (parcels.length === 0) return "No known uncollected parcels";
                return JSON.stringify(
                    parcels.map((p) => ({
                        id: p.id,
                        x: p.x,
                        y: p.y,
                        reward: p.reward,
                    }))
                );
            },

            /**
             * Returns known delivery tile positions.
             */
            get_delivery_tiles: async () => {
                const tiles = [...this.beliefs.deliveryTiles].map((k) => {
                    const [x, y] = k.split(",").map(Number);
                    return { x, y };
                });
                if (tiles.length === 0) return "No delivery tiles known";
                return JSON.stringify(tiles);
            },

            /**
             * Intention coordination — §6.
             * Returns the set of parcel IDs the partner BDI Agent A is pursuing.
             */
            get_agent_a_intentions: async () => {
                const intentions = this.agent?.partnerIntentions;
                if (!intentions || intentions.size === 0) {
                    return "Agent A has no committed intentions";
                }
                return JSON.stringify([...intentions]);
            },
        };
    }

    setAgent(agent) {
        this.agent = agent;
    }

    /**
     * Execute a tool by name with the given input string.
     * @param {string} toolName
     * @param {string} input
     * @returns {Promise<string>}
     */
    async execute(toolName, input) {
        const tool = this.TOOLS[toolName];
        if (!tool) {
            return `Error: unknown tool '${toolName}'`;
        }
        return await tool(input);
    }

    /**
     * Attempts to solve navigation via the PDDL online solver.
     * Uses onlineSolver() from @unitn-asa/pddl-client — free, no API key needed.
     * It calls solver.planning.domains:5001 internally.
     * @returns {string|null} result string, or null to fall back to A*
     */
    async _tryPddlSolve(targetX, targetY) {
        try {
            const { onlineSolver, Beliefset, PddlProblem } = await import("@unitn-asa/pddl-client");

            const me = this.beliefs.me;
            const myBeliefset = new Beliefset();

            // Declare agent position
            myBeliefset.declare(`at a1 t_${Math.round(me.x)}_${Math.round(me.y)}`);

            // Declare goal tile
            const goalTile = `t_${targetX}_${targetY}`;

            // Declare walkable tiles and adjacency
            for (const key of this.beliefs.walkableTiles) {
                const [tx, ty] = key.split(",").map(Number);
                const tileName = `t_${tx}_${ty}`;
                myBeliefset.declare(`tile ${tileName}`);

                // Add adjacency for 4-connected neighbors
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = tx + dx;
                    const ny = ty + dy;
                    const nk = `${nx},${ny}`;
                    if (this.beliefs.walkableTiles.has(nk)) {
                        myBeliefset.declare(`adjacent ${tileName} t_${nx}_${ny}`);
                    }
                }
            }

            // PDDL domain for navigation
            // Note: domain MUST be named 'default' to match PddlProblem's hardcoded (:domain default)
            const domainStr = `(define (domain default)
  (:requirements :strips)
  (:predicates
    (tile ?t)
    (at ?a ?t)
    (adjacent ?t1 ?t2)
  )
  (:action move
    :parameters (?a ?from ?to)
    :precondition (and (at ?a ?from) (tile ?from) (tile ?to) (adjacent ?from ?to))
    :effect (and (at ?a ?to) (not (at ?a ?from)))
  )
)`;

            // PddlProblem.toPddlString() wraps goal in (), so don't add outer parens
            const problemStr = new PddlProblem(
                "default",
                myBeliefset.objects.join(" "),
                myBeliefset.toPddlString(),
                `at a1 ${goalTile}`
            ).toPddlString();

            // Use the library's built-in solver (no key needed)
            const plan = await onlineSolver(domainStr, problemStr);

            if (!plan || plan.length === 0) {
                return null; // No plan found, fall back to A*
            }

            console.log(`[LLM] PDDL plan found: ${plan.length} steps`);

            // Execute the PDDL plan
            // onlineSolver returns [{parallel, action, args: [arg1, arg2, ...]}]
            for (const step of plan) {
                // step.action = "move", step.args = ["a1", "T_3_4", "T_3_5"]
                if (step.args && step.args.length >= 3) {
                    const fromTile = step.args[1];
                    const toTile = step.args[2];
                    const fromMatch = fromTile.match(/t_(\d+)_(\d+)/i);
                    const toMatch = toTile.match(/t_(\d+)_(\d+)/i);

                    if (fromMatch && toMatch) {
                        const dx = parseInt(toMatch[1]) - parseInt(fromMatch[1]);
                        const dy = parseInt(toMatch[2]) - parseInt(fromMatch[2]);
                        let dir;
                        if (dx === 1) dir = "right";
                        else if (dx === -1) dir = "left";
                        else if (dy === 1) dir = "up";
                        else if (dy === -1) dir = "down";
                        else continue;


                        const moveResult = await this.TOOLS.move(dir);
                        if (moveResult.startsWith("Failed") || moveResult.startsWith("Error")) {
                            return `PDDL plan interrupted at step: ${moveResult}`;
                        }
                    }
                }
            }

            return `PDDL plan executed: arrived at (${targetX}, ${targetY})`;
        } catch (e) {
            console.error("[LLM] PDDL solver failed, falling back to A*:", e.message);
            return null;
        }
    }


    // ─── A* Navigation ──────────────────────────────────────

    /**
     * Uses A* pathfinding to navigate to (x, y), executing each move via the socket.
     * After arriving, reports visible parcels so the LLM can act on them.
     */
    async _moveToAStar(x, y) {
        const start = {
            x: Math.round(this.beliefs.me.x),
            y: Math.round(this.beliefs.me.y),
        };
        const goal = { x: Math.round(x), y: Math.round(y) };

        const path = aStar(start, goal, this.beliefs);
        if (!path || path.length < 2) {
            return `No path found to (${x}, ${y})`;
        }

        let stepsCompleted = 0;
        for (let i = 0; i < path.length - 1; i++) {
            const cur = path[i];
            const next = path[i + 1];
            let dir;
            if (next.x > cur.x) dir = "right";
            else if (next.x < cur.x) dir = "left";
            else if (next.y > cur.y) dir = "up";
            else if (next.y < cur.y) dir = "down";

            try {
                const result = await this.socket.emitMove(dir);
                if (result === false) {
                    return this._arrivalReport(x, y, stepsCompleted, `Movement blocked at step ${i + 1}`);
                }
                stepsCompleted++;
            } catch (e) {
                // Timeout — check if we actually moved
                await new Promise(r => setTimeout(r, 100));
                const nowX = Math.round(this.beliefs.me.x);
                const nowY = Math.round(this.beliefs.me.y);
                if (nowX === cur.x && nowY === cur.y) {
                    return this._arrivalReport(x, y, stepsCompleted, `Timeout at step ${i + 1}`);
                }
                stepsCompleted++; // We did move despite the timeout
            }

            // Opportunistic pickup during movement
            const cx = Math.round(this.beliefs.me.x);
            const cy = Math.round(this.beliefs.me.y);
            const parcelsHere = this.beliefs.parcels.filter(
                p => !p.carriedBy && Math.round(p.x) === cx && Math.round(p.y) === cy
            );
            if (parcelsHere.length > 0) {
                try {
                    const pickResult = await this.socket.emitPickup();
                    if (Array.isArray(pickResult) && pickResult.length > 0) {
                        this.beliefs.addCarriedParcels(pickResult);
                    }
                } catch (_) { /* ignore pickup timeout */ }
            }
        }

        return this._arrivalReport(x, y, stepsCompleted, null);
    }

    /**
     * Builds a rich observation string after navigation, including visible parcels.
     */
    _arrivalReport(targetX, targetY, steps, issue) {
        const pos = `(${Math.round(this.beliefs.me.x)}, ${Math.round(this.beliefs.me.y)})`;
        const carrying = this.beliefs.carriedParcels.length;

        let msg = issue
            ? `Route to (${targetX}, ${targetY}) stopped after ${steps} steps: ${issue}. Current position: ${pos}.`
            : `Arrived at (${targetX}, ${targetY}) via ${steps} steps.`;

        if (carrying > 0) {
            msg += ` Carrying ${carrying} parcel(s).`;
        }

        // If navigation to a delivery tile failed, suggest trying a different one
        if (issue && this.beliefs.deliveryTiles.has(`${targetX},${targetY}`)) {
            msg += ` WARNING: delivery tile (${targetX},${targetY}) is blocked. Use get_delivery_tiles() and plan_route to a DIFFERENT delivery tile.`;
        }

        // Report visible parcels so the LLM can decide to pick them up
        const visible = this.beliefs.parcels
            .filter(p => !p.carriedBy)
            .slice(0, 5)
            .map(p => `${p.id}@(${p.x},${p.y}) r=${p.reward}`);
        if (visible.length > 0) {
            msg += ` Visible parcels: [${visible.join(", ")}]`;
        } else {
            msg += ` No parcels visible.`;
        }

        return msg;
    }
}
