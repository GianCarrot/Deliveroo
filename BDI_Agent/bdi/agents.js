import { desires } from "./desires.js";
import { intentions } from "./intentions.js";

export class BDIAgent {
    constructor(socket, beliefs) {
        this.socket = socket;
        this.beliefs = beliefs;
    }

    reviseAgents(perceivedAgents) {
        const now = Date.now();
        const currentNames = perceivedAgents.map(a => a.name);

        // --- 1. Analysis of agents connected ---
        perceivedAgents.forEach(a => {
            const oldB = this.beliefs.agents.get(a.name);

            if (!oldB) {
                console.log('Hello', a.name);
            } else {
                const moved = oldB.x !== a.x || oldB.y !== a.y;
                const seenJustBefore = this.beliefs.lastPerceptionAgents.includes(a.name);

                if (seenJustBefore) {
                    if (moved) console.log('You are moving', a.name);
                    else console.log('You are still in same place as before');
                } else {
                    if (moved) console.log('Welcome back, seems that moved', a.name);
                    else console.log('Welcome back, seems you are still here as before', a.name);
                }
            }
            // Updating beliefs
            this.beliefs.agents.set(a.name, { x: a.x, y: a.y, timestamp: now });
        });

        // --- 2. Forgetting of disconnected agents ---
        for (let [name, b] of this.beliefs.agents) {
            if (currentNames.includes(name)) continue;

            const wasSeenJustBefore = this.beliefs.lastPerceptionAgents.includes(name);
            // Calcolo distanza tra me e dove ricordo fosse l'agente
            const dist = Math.abs(this.beliefs.me.x - b.x) + Math.abs(this.beliefs.me.y - b.y);

            if (wasSeenJustBefore) {
                console.log('Bye', name);
            } else if (dist <= 3) {
                console.log(`I remember ${name} was within 3 tiles from here. Forget him.`);
                this.beliefs.agents.delete(name);
            } else {
                console.log(`Its a while that I don't see ${name}, I remember him in ${b.x},${b.y}`);
            }
        }

        // Store names for the next loop
        this.beliefs.lastPerceptionAgents = currentNames;
    }

    getNearestParcel() {
        const me = this.beliefs.me;
        const parcels = this.beliefs.parcels;

        return parcels
            .filter(p => !p.carriedBy)
            .sort((a, b) => {
                const d1 = Math.abs(a.x - me.x) + Math.abs(a.y - me.y);
                const d2 = Math.abs(b.x - me.x) + Math.abs(b.y - me.y);
                return d1 - d2;
            })[0];
    }
    
    deliberate() {
        if (desires.deliverParcel(this.beliefs)) 
            return "deliverParcel";
        if (desires.pickParcel(this.beliefs)) 
            return "pickParcel";
        return null;
    }

    async execute(intention) {
        if (!intention) 
            return;
        await intentions[intention](this);
    }

    async step() {
        const intention = this.deliberate();
        console.log("Intention:", intention);
        await this.execute(intention);
    }

    async moveTowardNearestParcel() {
        const p = this.getNearestParcel();
        if (!p) return;
        await this.moveToward(p.x, p.y);
    }

    async moveTowardDeliveryTile() {
        const delivery = this.beliefs.tiles.find(t => t.type === "2");
        if (!delivery) 
            return;
        await this.moveToward(delivery.x, delivery.y);
    }

    async moveToward(tx, ty) {
        const me = this.beliefs.me;

        let dir = null;
        if (tx > me.x) 
            dir = "right";
        else if (tx < me.x) 
            dir = "left";
        else if (ty > me.y) 
            dir = "up";
        else if (ty < me.y) 
            dir = "down";

        if (dir) 
            await this.socket.emitMove(dir);
    }
}