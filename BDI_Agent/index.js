import dotenv from "dotenv";
dotenv.config();

import { connect } from "./deliveroo/connection.js";
import { Beliefs } from "./bdi/beliefs.js";
import { BDIAgent } from "./bdi/agents.js";

const socket = connect();
const beliefs = new Beliefs();
const agent = new BDIAgent(socket, beliefs);

console.log(socket, beliefs, agent)

// Event listeners
socket.on("you", (me) => {
    Object.assign(beliefs.me, me);
});

socket.on("parcelsSensing", parcels => {
    beliefs.parcels = parcels;
});

socket.on("agentsSensing", agents => {
    agent.reviseAgents(agents);
});

// Ciclo BDI ogni 200ms
setInterval(() => agent.step(), 200);