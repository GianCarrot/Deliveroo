import { desires } from "./desires.js";
import { intentions } from "./intentions.js";

export class BDIAgent {
    constructor(socket, beliefs) {
        this.socket = socket;
        this.beliefs = beliefs;
    }

    deliberate() {
        if (desires.deliverParcel(this.beliefs)) return "deliverParcel";
        if (desires.pickParcel(this.beliefs)) return "pickParcel";
        return null;
    }

    async execute(intention) {
        if (!intention) return;
        await intentions[intention](this);
    }

    async step() {
        const intention = this.deliberate();
        await this.execute(intention);
    }
}