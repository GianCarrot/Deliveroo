import { aStar } from "./pathfinding.js";

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

    wander: async (agent, intention) => {
        const x = Math.round(agent.beliefs.me.x);
        const y = Math.round(agent.beliefs.me.y);

        // Check the current tile type — if arrow, must go that direction
        const tileType = agent.beliefs.getTileType(x, y);
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
            const isWalkable = agent.beliefs.walkableTiles.has(nk);
            // Check dynamic obstacles
            const hasAgent = Array.from(agent.beliefs.agentsMap.values()).some(
                a => Math.round(a.x) === (x + dx) && Math.round(a.y) === (y + dy)
            );
            return isWalkable && !hasAgent;
        });

        if (walkable.length === 0) {
            // fallback to any valid dir to avoid freezing
            const dirs = ["up", "down", "left", "right"];
            const dir = dirs[Math.floor(Math.random() * dirs.length)];
            return [{ action: "move", dir }];
        }

        const choice = walkable[Math.floor(Math.random() * walkable.length)];
        return [{ action: "move", dir: choice.dir }];
    }
};