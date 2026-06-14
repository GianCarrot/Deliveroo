import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { connect } from "../shared/connection.js";
import { Beliefs } from "./bdi/beliefs.js";
import { BDIAgent } from "./bdi/agents.js";
import { MSG } from "../shared/common_protocol.js";

/**
 * Starts the BDI Agent on the given socket.
 * Sets up event listeners, the BDI cycle, and inter-agent communication.
 * @param {object} socket — connected Deliveroo socket
 * @returns {{ socket, agent: BDIAgent, beliefs: Beliefs }}
 */
export function startBDIAgent(socket) {
    const beliefs = new Beliefs();
    const agent = new BDIAgent(socket, beliefs);

    // ─── Change detection for emitSay (avoid chat spam) ──
    let _lastParcelFP = "";
    let _lastIntentionId = null;

    // ─── Event Listeners ─────────────────────────────────
    socket.on("config", (config) => {
        beliefs.updateConfig(config);
    });

    socket.on("map", (width, height, tiles) => {
        beliefs.updateMap(width, height, tiles);
    });

    socket.on("you", (me) => {
        beliefs.updateMe(me);
    });

    socket.on("sensing", async (sensing) => {
        try {
            const { parcels, agents: agentsList, crates } = sensing;

            if (parcels) {
                beliefs.updateParcels(parcels);

                // Sync carried parcels from sensing (authoritative source)
                if (beliefs.me.id) {
                    const carriedParcels = parcels.filter(p => p.carriedBy === beliefs.me.id);
                    beliefs.me.carrying = carriedParcels.length;
                    beliefs.carriedParcels = carriedParcels.map(p => p.id);
                }

                // Share visible parcels with partner (only when changed)
                if (agent.partnerId) {
                    const fp = parcels.map(p => p.id).sort().join(",");
                    if (fp !== _lastParcelFP) {
                        _lastParcelFP = fp;
                        try {
                            await socket.emitSay(agent.partnerId, MSG.beliefUpdate(parcels));
                        } catch (e) { /* partner may not be connected yet */ }
                    }
                }
            }

            if (agentsList) {
                beliefs.updateAgents(agentsList);
            }

            if (crates) {
                beliefs.updateCrates(crates);
            }

            await agent.step();

            // Send intention to partner (only when changed)
            if (agent.partnerId) {
                const curIntentionId = agent.intention?.target?.id || null;
                if (curIntentionId !== _lastIntentionId) {
                    _lastIntentionId = curIntentionId;
                    try {
                        if (curIntentionId) {
                            await socket.emitSay(agent.partnerId, MSG.intentionCommit(curIntentionId));
                        } else {
                            await socket.emitSay(agent.partnerId, MSG.intentionClear());
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        } catch (e) {
            console.error("[BDI] CRASH IN SENSING EVENT:", e);
        }
    });

    // ─── Receive messages from team partner only ──────────
    socket.on("msg", (fromId, fromName, msg) => {
        if (!msg || !msg.type) return;

        // Only process structured protocol messages from our team partner
        if (fromId !== agent.partnerId) return;

        if (msg.type === MSG.TYPES.BELIEF_UPDATE) {
            for (const p of msg.parcels) {
                // Only add parcels we don't already know about and that aren't carried
                if (!beliefs.parcelsMap.has(p.id) && !p.carriedBy) {
                    beliefs.parcelsMap.set(p.id, {
                        ...p,
                        lastSeen: Date.now(),
                        originalReward: p.reward,
                    });
                }
            }
        } else if (msg.type === MSG.TYPES.INTENTION_COMMIT) {
            agent.partnerIntentions.clear();
            if (msg.parcelId) {
                agent.partnerIntentions.add(msg.parcelId);
            }
        } else if (msg.type === MSG.TYPES.INTENTION_CLEAR) {
            agent.partnerIntentions.clear();
        }
    });

    socket.on("connect", () => console.log("[BDI] Connected to server"));
    socket.on("connect_error", (err) => console.log("[BDI] Connection error:", err.message));

    return { socket, agent, beliefs };
}

// ─── Standalone mode ─────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
    dotenv.config();
    const socket = connect();
    startBDIAgent(socket);
}