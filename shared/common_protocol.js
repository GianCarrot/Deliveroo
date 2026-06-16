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
        DIRECTIVE: "directive",
        DIRECTIVE_CLEAR: "directive_clear",
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

    /**
     * Creates a directive message commanding the partner to perform an action.
     * @param {string} action — e.g. "go_to"
     * @param {{ x: number, y: number }} params — action parameters
     * @returns {{ type: string, action: string, x: number, y: number }}
     */
    directive(action, params) {
        return {
            type: MSG.TYPES.DIRECTIVE,
            action,
            ...params,
        };
    },

    /**
     * Creates a directive_clear message, cancelling any active directive.
     * @returns {{ type: string }}
     */
    directiveClear() {
        return {
            type: MSG.TYPES.DIRECTIVE_CLEAR,
        };
    },
};