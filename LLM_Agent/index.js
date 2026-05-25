import dotenv from "dotenv";
dotenv.config();

import { connect } from "../BDI_Agent/deliveroo/connection.js";
import { Beliefs } from "../BDI_Agent/bdi/beliefs.js";
import { BDIAgent } from "../BDI_Agent/bdi/agents.js";

import { LLMMemory } from "../LLM_Agent/LLMMemory.js";
import { LLMExecutor } from "../LLM_Agent/LLMExecutor.js";
import { LLMPlanner } from "../LLM_Agent/LLMPlanner.js";
import { LLMReplanner } from "../LLM_Agent/LLMReplanner.js";
import { LLMAgent } from "../LLM_Agent/LLMAgent.js";

// ─────────────────────────────────────────────
// 1. BDI SETUP
// ─────────────────────────────────────────────

const socket = connect();
const beliefs = new Beliefs();
const bdiAgent = new BDIAgent(socket, beliefs);

// ─────────────────────────────────────────────
// 2. LLM SETUP
// ─────────────────────────────────────────────

const memory = new LLMMemory(bdiAgent);
const executor = new LLMExecutor(bdiAgent);
const replanner = new LLMReplanner();

const planner = new LLMPlanner({
    baseURL: process.env.LITELLM_BASE_URL,
    apiKey: process.env.LITELLM_API_KEY,
    model: process.env.LOCAL_MODEL
});

const llmAgent = new LLMAgent({
    memory,
    planner,
    executor,
    replanner
});

// ─────────────────────────────────────────────
// 3. CONTROL FLAGS
// ─────────────────────────────────────────────

let objectiveSet = false;

// ─────────────────────────────────────────────
// 4. EVENT HANDLERS
// ─────────────────────────────────────────────

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
    beliefs.updateParcels(sensing.parcels);
    beliefs.updateAgents(sensing.agents);

    memory.updateWorld();

    // Imposta l’obiettivo UNA sola volta
    if (!objectiveSet && beliefs.parcels.length > 0) {
        console.log("World ready → setting objective...");
        await llmAgent.setObjective("Collect the nearest parcel and deliver it");
        objectiveSet = true;
    }

    // Esegui il piano
    await llmAgent.step();
});

socket.on("connect", () => console.log("Connected to server"));
socket.on("connect_error", (err) => console.log("Connection error:", err.message));