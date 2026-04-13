import dotenv from "dotenv";
dotenv.config();

import { connect } from "./deliveroo/connection.js";
import { Beliefs } from "./bdi/beliefs.js";
import { BDIAgent } from "./bdi/agents.js";

const socket = connect();
const beliefs = new Beliefs();
const agent = new BDIAgent(socket, beliefs);

console.log(socket, beliefs, agent);

// Stato precedente per evitare log ripetuti
let lastPos = { x: null, y: null };
let lastCarrying = 0;

// Event listeners
socket.on("you", (me) => {
    beliefs.me.id = me.id;
    beliefs.me.x = me.x;
    beliefs.me.y = me.y;
    beliefs.me.score = me.score;

    const posChanged = Math.floor(me.x) !== lastPos.x || Math.floor(me.y) !== lastPos.y;
    if (posChanged) {
        lastPos.x = Math.floor(me.x);
        lastPos.y = Math.floor(me.y);
        console.log("You:", beliefs.me);
    }
});

socket.on("map", (width, height, tiles) => {
    beliefs.map = tiles;
    console.log("Map received:", tiles.length, "tiles");
});

// L'SDK emette un unico evento "sensing" con { parcels, agents, positions, crates }
socket.on("sensing", async (sensing) => {
    const { parcels, agents } = sensing;

    if (parcels) {
        beliefs.updateParcels(parcels);
        if (beliefs.me.id) {
            const carriedParcels = parcels.filter(p => p.carriedBy === beliefs.me.id);
            beliefs.me.carrying = carriedParcels.reduce((sum, p) => sum + p.reward, 0);
        }
    }

    // TODO: riattivare quando il motore di deliberazione sarà pronto
    // await agent.step();
});

socket.on("connect", () => {
    console.log("Connected to server");
});

socket.on("connect_error", (err) => {
    console.log("Connection error:", err.message);
});
