export const intentions = {
    pickParcel: async (agent) => {
        console.log("Intent: pick parcel");

        // se ho già un target → continua verso quello
        if (agent.beliefs.currentTarget) {
            await agent.moveTowardTarget();
            return;
        }

        // altrimenti scelgo il più vicino
        const p = agent.getNearestParcel();
        if (!p) return;

        agent.beliefs.currentTarget = {
            x: Math.round(p.x),
            y: Math.round(p.y),
            id: p.id
        };

        await agent.moveTowardTarget();
    },

    deliverParcel: async (agent) => {
        console.log("Intent: deliver parcel");
        await agent.moveTowardDeliveryTile();
        await agent.socket.emitPutdown();
    },

    wander: async (agent) => {
        console.log("Intent: wander");
        const dirs = ["up", "down", "left", "right"];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        await agent.socket.emitMove(dir);
    }
};