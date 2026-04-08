export class Beliefs {
    constructor() {
        this.me = { x: 0, y: 0 };
        this.parcels = [];
        this.map = null;

        this.agents = new Map();
        this.lastPrecpetionAgents = [];
    }
}