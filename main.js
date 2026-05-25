/**
 * Multi-agent launcher.
 * Starts both the BDI Agent (A) and the LLM Agent (B) in a single process,
 * each with its own socket connection and independent beliefs.
 * After both connect, exchanges partner IDs so they can communicate via emitSay.
 */
import dotenv from "dotenv";
import fs from "fs";
import { connect } from "./BDI_Agent/deliveroo/connection.js";
import { startBDIAgent } from "./BDI_Agent/index.js";
import { startLLMAgent } from "./LLM_Agent/index.js";

// ─── Load each agent's .env file ────────────────────────
const bdiEnv = dotenv.parse(fs.readFileSync("./BDI_Agent/.env"));
const llmEnv = dotenv.parse(fs.readFileSync("./LLM_Agent/.env"));

console.log("[main] Starting multi-agent system...");

// ─── Create independent sockets ─────────────────────────
const socketA = connect(bdiEnv.HOST, bdiEnv.TOKEN);
const socketB = connect(llmEnv.HOST, llmEnv.TOKEN);

// ─── Start both agents ──────────────────────────────────
const bdi = startBDIAgent(socketA);
const llm = startLLMAgent(socketB, {
    baseURL: llmEnv.LITELLM_BASE_URL,
    apiKey: llmEnv.LITELLM_API_KEY,
    model: llmEnv.LOCAL_MODEL,
});

// ─── Exchange partner IDs after both connect ─────────────
let bdiId = null;
let llmId = null;

function tryExchangeIds() {
    if (bdiId && llmId) {
        bdi.agent.setPartnerId(llmId);
        llm.llmAgent.setPartnerId(bdiId);
        console.log(`[main] Partner IDs exchanged: BDI=${bdiId} ↔ LLM=${llmId}`);
    }
}

socketA.on("you", (me) => {
    bdiId = me.id;
    tryExchangeIds();
});

socketB.on("you", (me) => {
    llmId = me.id;
    tryExchangeIds();
});