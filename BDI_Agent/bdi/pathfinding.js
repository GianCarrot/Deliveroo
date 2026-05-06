/**
 * Arrow tile type → the only direction allowed to exit from that tile.
 * @type {Map<string, [number, number]>}
 */
const ARROW_DIRECTION = {
    '↑': [0, 1],   // up   → +y
    '↓': [0, -1],  // down → -y
    '→': [1, 0],   // right → +x
    '←': [-1, 0],  // left  → -x
};

/**
 * A* pathfinding with arrow tile constraints and dynamic obstacle avoidance.
 *
 * @param {{ x: number, y: number }} start - Starting position (integer coords)
 * @param {{ x: number, y: number }} goal  - Goal position (integer coords)
 * @param {import('./beliefs.js').Beliefs} beliefs - Belief state
 * @returns {Array<{ x: number, y: number }>|null} Path from start to goal (inclusive), or null
 */
export function aStar(start, goal, beliefs) {

    const key = (x, y) => `${x},${y}`;

    // Build a set of cells occupied by other agents (dynamic obstacles)
    const agentCells = new Set();
    for (const agent of beliefs.agentsMap.values()) {
        const ax = Math.round(agent.x);
        const ay = Math.round(agent.y);
        const ak = key(ax, ay);
        // Don't block the goal — the agent may move away by the time we arrive
        if (ax !== goal.x || ay !== goal.y) {
            agentCells.add(ak);
        }
    }

    const startKey = key(start.x, start.y);
    const open = new Set([startKey]);
    const closed = new Set();
    const cameFrom = new Map();

    const g = new Map();
    g.set(startKey, 0);

    const f = new Map();
    f.set(startKey, heuristic(start, goal));

    function heuristic(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }

    /**
     * Returns valid neighbor cells from (x, y), respecting:
     * - Map bounds and walkability
     * - Arrow tile directional constraints (from the CURRENT cell)
     * - Dynamic obstacles (other agents)
     */

    function canEnter(x, y, fromX, fromY) {
        const tileType = beliefs.getTileType(x, y);
        if (!ARROW_DIRECTION[tileType]) return true;

        const [dx, dy] = ARROW_DIRECTION[tileType];
        // si può entrare solo se si arriva dalla direzione opposta
        return (x - fromX === dx * -1) && (y - fromY === dy * -1);
    }

    function neighbors(x, y) {
        const tileType = beliefs.getTileType(x, y);

        // If the current tile is an arrow tile, only allow movement in that direction
        if (tileType && ARROW_DIRECTION[tileType]) {
            const [dx, dy] = ARROW_DIRECTION[tileType];
            const nx = x + dx;
            const ny = y + dy;
            const nk = key(nx, ny);
            if (beliefs.walkableTiles.has(nk) && !agentCells.has(nk)) {
                return [[nx, ny]];
            }
            return [];
        }

        // Standard tile: allow all 4 directions
        const dirs = [
            [1, 0], [-1, 0],
            [0, 1], [0, -1]
        ];

        return dirs
            .map(([dx, dy]) => [x + dx, y + dy])
            .filter(([nx, ny]) => {
                const nk = key(nx, ny);
                return beliefs.walkableTiles.has(nk)
                    && !agentCells.has(nk)
                    && canEnter(nx, ny, x, y);
            });
    }

    while (open.size > 0) {

        // Node with lowest f score
        let current = null;
        let bestF = Infinity;

        for (const k of open) {
            const val = f.get(k) ?? Infinity;
            if (val < bestF) {
                bestF = val;
                current = k;
            }
        }

        const [cx, cy] = current.split(",").map(Number);

        if (cx === goal.x && cy === goal.y) {
            // Reconstruct path (including start node)
            const path = [];
            let cur = current;

            while (cur) {
                const [px, py] = cur.split(",").map(Number);
                path.push({ x: px, y: py });
                cur = cameFrom.get(cur) ?? null;
            }

            path.reverse();
            return path;
        }

        open.delete(current);
        closed.add(current);

        for (const [nx, ny] of neighbors(cx, cy)) {
            const nk = key(nx, ny);
            if (closed.has(nk)) continue;

            const tentativeG = (g.get(current) ?? Infinity) + 1;

            if (tentativeG < (g.get(nk) ?? Infinity)) {
                cameFrom.set(nk, current);
                g.set(nk, tentativeG);
                f.set(nk, tentativeG + heuristic({ x: nx, y: ny }, goal));
                open.add(nk);
            }
        }
    }

    return null;
}