import dotenv from "dotenv";
dotenv.config();

import { connect } from "./deliveroo/connection.js";
import { Beliefs } from "./bdi/beliefs.js";
import { BDIAgent } from "./bdi/agents.js";

const socket = connect();
const beliefs = new Beliefs();
const agent = new BDIAgent(socket, beliefs);

// Event listeners
socket.on("you", (player) => {
    beliefs.me.id = player.id;
    beliefs.me.x = player.x;
    beliefs.me.y = player.y;
    beliefs.me.score = player.score;
    beliefs.me.carrying = player.carriedParcels?.length ?? 0;

    console.log("You:", beliefs.me);
});

socket.on("map", (width, height, tiles) => {
    beliefs.map = tiles;
    console.log("Map received:", tiles.length, "tiles");
});

socket.on("parcelsSensing", parcels => {
    beliefs.parcels = parcels;
    console.log("Parcels:", parcels);
});

socket.on("agentsSensing", async () => {
    console.log("Tick: agentsSensing");
    await agent.step();
});

socket.on("connect", () => {
    console.log("✓ Connected to server!");
});

socket.on("connect_error", (err) => {
    console.log("✗ Connection error:", err.message);
});
