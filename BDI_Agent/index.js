import dotenv from "dotenv";
dotenv.config();

import { connect } from "./deliveroo/connection.js";
import { Beliefs } from "./bdi/beliefs.js";
import { BDIAgent } from "./bdi/agent.js";

const socket = connect();
const beliefs = new Beliefs();
const agent = new BDIAgent(socket, beliefs);

// Event listeners
socket.on("you", (id, name, x, y) => {
    beliefs.me = { x, y };
});

socket.on("parcelsSensing", parcels => {
    beliefs.parcels = parcels;
});

// Ciclo BDI ogni 200ms
setInterval(() => agent.step(), 200);