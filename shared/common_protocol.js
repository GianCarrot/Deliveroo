/**
 * Shared communication protocol for BDI ↔ LLM agent messaging.
 * Messages are sent via socket.emitSay() and received via socket.on('msg').
 */

export const MSG = {
    // Message type constants
    TYPES: {
        BELIEF_UPDATE: "belief_update",
        INTENTION_COMMIT: "intention_commit",
        INTENTION_CLEAR: "intention_clear",
    },

    /**
     * Creates a belief_update message containing parcels visible to the sender.
     * @param {Array} parcels — array of parcel objects from sensing
     * @returns {{ type: string, parcels: Array }}
     */
    beliefUpdate(parcels) {
        return {
            type: MSG.TYPES.BELIEF_UPDATE,
            parcels: parcels.map(p => ({
                id: p.id,
                x: p.x,
                y: p.y,
                reward: p.reward,
                carriedBy: p.carriedBy ?? null,
            })),
        };
    },

    /**
     * Creates an intention_commit message declaring the sender is pursuing a parcel.
     * @param {string} parcelId
     * @returns {{ type: string, parcelId: string }}
     */
    intentionCommit(parcelId) {
        return {
            type: MSG.TYPES.INTENTION_COMMIT,
            parcelId,
        };
    },

    /**
     * Creates an intention_clear message indicating the sender released its commitment.
     * @returns {{ type: string }}
     */
    intentionClear() {
        return {
            type: MSG.TYPES.INTENTION_CLEAR,
        };
    },
};