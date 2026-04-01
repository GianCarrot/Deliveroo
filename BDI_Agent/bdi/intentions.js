export const intentions = {
    pickParcel: async (agent) => {
        console.log("Intent: pick parcel");
        await agent.moveTowardNearestParcel();
        await agent.socket.emitPickup();
    },

    deliverParcel: async (agent) => {
        console.log("Intent: deliver parcel");
        await agent.moveTowardDeliveryTile();
        await agent.socket.emitPutdown();
    }
};