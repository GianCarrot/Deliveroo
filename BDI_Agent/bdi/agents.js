import { desires } from "./desires.js";
import { intentions } from "./intentions.js";

export class BDIAgent {
    constructor(socket, beliefs) {
        this.socket = socket;
        this.beliefs = beliefs;
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
        const parcels = this.beliefs.parcels;
        if (parcels.length === 0) 
            return;

        const p = parcels[0]; // greedy
        await this.moveToward(p.x, p.y);
    }

    async moveTowardDeliveryTile() {
        const delivery = this.beliefs.map.find(t => t.type === "2");
        if (!delivery) 
            return;
        await this.moveToward(delivery.x, delivery.y);
    }

    async moveToward(tx, ty) {
        const me = this.beliefs.me;

        let dir = null;
        if (tx > me.x) dir = "right";
        else if (tx < me.x) dir = "left";
        else if (ty > me.y) dir = "up";
        else if (ty < me.y) dir = "down";

        if (dir) await this.socket.emitMove(dir);
    }
}