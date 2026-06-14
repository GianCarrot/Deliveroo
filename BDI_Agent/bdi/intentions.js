import { aStar } from "../../shared/pathfinding.js";

/**
 * Arrow tile symbols mapped to the direction they force.
 */
const ARROW_DIRS = { '↑': 'up', '↓': 'down', '→': 'right', '←': 'left' };

/**
 * Direction deltas: direction name → (dx, dy).
 */
const DIR_DELTA = {
    up: { dx: 0, dy: 1 },
    down: { dx: 0, dy: -1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
};

/**
 * Checks if moving in `dir` from (x, y) is safe.
 * A move is UNSAFE if:
 *   - The destination is a wall (not walkable)
 *   - The destination is an arrow tile whose forced direction would
 *     send the agent backward (opposite to the direction we arrived from)
 *   - The destination is occupied by another agent
 *
 * @param {number} x  Current integer x
 * @param {number} y  Current integer y
 * @param {string} dir  Direction to move
 * @param {import('./beliefs.js').Beliefs} beliefs
 * @returns {boolean} true if safe
 */
function isMoveSafe(x, y, dir, beliefs) {
    const { dx, dy } = DIR_DELTA[dir];
    const nx = x + dx;
    const ny = y + dy;
    const nk = `${nx},${ny}`;

    // Wall check: destination must be walkable
    if (!beliefs.walkableTiles.has(nk)) return false;

    // Arrow-tile check: if destination is an arrow tile,
    // the forced direction must NOT be the opposite of our movement direction
    const destType = beliefs.getTileType(nx, ny);
    if (destType && ARROW_DIRS[destType]) {
        const forcedDir = ARROW_DIRS[destType];
        const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' };
        if (forcedDir === opposite[dir]) {
            return false; // stepping onto this arrow would bounce us back
        }
    }

    // Agent check: destination must not be occupied by another agent
    for (const agent of beliefs.agentsMap.values()) {
        if (Math.round(agent.x) === nx && Math.round(agent.y) === ny) {
            return false;
        }
    }

    return true;
}

export const intentions = {
    pickParcel: async (agent, intention) => {
        const goal = intention.target;
        if (!goal) return [];
        const start = { x: Math.round(agent.beliefs.me.x), y: Math.round(agent.beliefs.me.y) };
        const goalRounded = { x: Math.round(goal.x), y: Math.round(goal.y) };
        const path = aStar(start, goalRounded, agent.beliefs);
        if (!path) {
            console.log("A* path (pickParcel): no path found");
            return [];
        }
        console.log("A* path (pickParcel):", path.length, "nodes");
        const actions = agent.pathToActions(path);
        actions.push({ action: "pickup" });
        return actions;
    },

    deliverParcel: async (agent, intention) => {
        const goal = agent.getNearestDeliveryTile();
        if (!goal) {
            console.log("No delivery tile found on the map");
            return [];
        }
        const start = { x: Math.round(agent.beliefs.me.x), y: Math.round(agent.beliefs.me.y) };
        const goalRounded = { x: Math.round(goal.x), y: Math.round(goal.y) };
        const path = aStar(start, goalRounded, agent.beliefs);
        if (!path) {
            console.log("A* path (deliverParcel): no path found");
            return [];
        }
        console.log("A* path (deliverParcel):", path.length, "nodes");
        const actions = agent.pathToActions(path);
        actions.push({ action: "putdown" });
        return actions;
    },

    /**
     * goToSpawn: navigate to a spawn tile (type 1) using A*.
     * Continuously patrols between spawn tiles to discover parcels.
     * If on an arrow tile, obey the forced direction first.
     */
    goToSpawn: async (agent, intention) => {
        const x = Math.round(agent.beliefs.me.x);
        const y = Math.round(agent.beliefs.me.y);

        // If currently on an arrow tile, must follow its direction
        const currentType = agent.beliefs.getTileType(x, y);
        if (currentType && ARROW_DIRS[currentType]) {
            return [{ action: "move", dir: ARROW_DIRS[currentType] }];
        }

        // Collect reachable spawn tiles (min distance 5 to avoid oscillation)
        const MIN_SPAWN_DIST = 5;
        const myPos = { x, y };
        const candidates = [];

        for (const key of agent.beliefs.spawnTiles) {
            const [sx, sy] = key.split(",").map(Number);
            const manhattan = Math.abs(sx - x) + Math.abs(sy - y);
            if (manhattan < MIN_SPAWN_DIST) continue;

            const path = aStar(myPos, { x: sx, y: sy }, agent.beliefs);
            if (path && path.length > 1) {
                candidates.push({ path, dist: path.length });
            }
        }

        if (candidates.length > 0) {
            // Pick randomly among the closest candidates (top 3) to avoid deterministic oscillation
            candidates.sort((a, b) => a.dist - b.dist);
            const topN = candidates.slice(0, Math.min(3, candidates.length));
            const chosen = topN[Math.floor(Math.random() * topN.length)];
            const target = chosen.path[chosen.path.length - 1];
            console.log(`goToSpawn: patrolling to spawn at (${target.x},${target.y}), ${chosen.dist} steps`);
            return agent.pathToActions(chosen.path);
        }

        // Fallback: no reachable spawn tile — pick a safe random direction
        const dirs = ["up", "down", "left", "right"];
        const safeDirs = dirs.filter(d => isMoveSafe(x, y, d, agent.beliefs));

        if (safeDirs.length > 0) {
            const choice = safeDirs[Math.floor(Math.random() * safeDirs.length)];
            return [{ action: "move", dir: choice }];
        }

        // Absolute fallback: pick any direction (should rarely happen)
        const fallback = dirs[Math.floor(Math.random() * dirs.length)];
        return [{ action: "move", dir: fallback }];
    }
};