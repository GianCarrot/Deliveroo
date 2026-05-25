import { aStar } from "../BDI_Agent/bdi/pathfinding.js";

export class LLMExecutor {
    constructor(socket, beliefs) {
        this.socket = socket;
        this.beliefs = beliefs;
    }

    async execute(tool, ...args) {
        switch (tool) {
            case "moveTo":
                return await this._moveTo(args[0], args[1]);
            case "move":
                return await this._move(args[0]);
            case "pickup":
                return await this._pickup();
            case "putdown":
                return await this._putdown();
            case "get_my_position":
                return JSON.stringify({
                    x: this.beliefs.me.x,
                    y: this.beliefs.me.y,
                    score: this.beliefs.me.score,
                });
            default:
                throw new Error(`Unknown tool '${tool}'`);
        }
    }

    async _move(direction) {
        try {
            const result = await this.socket.emitMove(direction);
            return result !== false
                ? `Moved ${direction}`
                : `Failed to move ${direction}`;
        } catch (e) {
            return `Error moving: ${e.message}`;
        }
    }

    async _pickup() {
        try {
            const result = await this.socket.emitPickup();
            if (Array.isArray(result) && result.length > 0) {
                this.beliefs.addCarriedParcels(result);
                return `Picked up ${result.length} parcel(s)`;
            }
            return "No parcels to pick up";
        } catch (e) {
            return `Error picking up: ${e.message}`;
        }
    }

    async _putdown() {
        try {
            const result = await this.socket.emitPutdown();
            if (Array.isArray(result) && result.length > 0) {
                this.beliefs.clearCarriedParcels();
                return `Delivered ${result.length} parcel(s)`;
            }
            return "No parcels to deliver";
        } catch (e) {
            return `Error delivering: ${e.message}`;
        }
    }

    /**
     * Uses A* pathfinding to navigate to (x, y), executing each move via the socket.
     */
    async _moveTo(x, y) {
        const start = {
            x: Math.round(this.beliefs.me.x),
            y: Math.round(this.beliefs.me.y),
        };
        const goal = { x: Math.round(x), y: Math.round(y) };

        const path = aStar(start, goal, this.beliefs);
        if (!path || path.length < 2) {
            return `No path found to (${x}, ${y})`;
        }

        for (let i = 0; i < path.length - 1; i++) {
            const cur = path[i];
            const next = path[i + 1];
            let dir;
            if (next.x > cur.x) dir = "right";
            else if (next.x < cur.x) dir = "left";
            else if (next.y > cur.y) dir = "up";
            else if (next.y < cur.y) dir = "down";

            const result = await this._move(dir);
            if (result.startsWith("Failed") || result.startsWith("Error")) {
                return `MoveTo stopped at step ${i + 1}: ${result}`;
            }
        }
        return `Arrived at (${x}, ${y})`;
    }
}
