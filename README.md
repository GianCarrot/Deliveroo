# Deliveroo Multi-Agent System

> Autonomous Software Agents — A.A. 2025-2026, University of Trento

## Overview

This project implements a team of two coordinated autonomous agents for the **Deliveroo.js** environment:

- **Agent A (BDI)** — Belief-Desire-Intention architecture with utility-based deliberation, A* pathfinding, and dynamic replanning
- **Agent B (LLM)** — Large Language Model agent using a ReAct-style reasoning loop, natural language instruction support, and PDDL planning integration

Both agents connect independently to the game server with separate sockets and tokens. They communicate via `socket.emitSay()` to share beliefs (visible parcels) and coordinate intentions (which parcel each is pursuing), avoiding conflicts.

---

## Project Structure

```text
deliveroo/
├── main.js                      # Multi-agent launcher (starts both agents, exchanges partner IDs)
├── package.json                 # Root dependencies (pddl-client, openai, dotenv, deliveroo-js-sdk)
│
├── shared/                      # Shared modules used by both agents
│   ├── common_protocol.js       # Message types & factories for inter-agent communication
│   ├── connection.js            # Socket connection wrapper (Deliveroo SDK)
│   └── pathfinding.js           # A* pathfinding with arrow tiles, crate handling, dynamic obstacles
│
├── BDI_Agent/
│   ├── .env                     # Agent A credentials (HOST, TOKEN)
│   ├── .env.example             # Template for Agent A credentials
│   ├── index.js                 # BDI entry point, event listeners, communication handlers
│   └── modules/
│       ├── agents.js            # BDIAgent class: BDI cycle, replanning, plan execution
│       ├── beliefs.js           # Beliefs: map, parcels, agents, forgetting logic, tile types
│       ├── desires.js           # Utility-based goal evaluation + partner intention filtering
│       └── intentions.js        # Goal → action plan mapping (pickParcel, deliverParcel, goToSpawn)
│
└── LLM_Agent/
    ├── .env                     # Agent B credentials + LLM API configuration
    ├── .env.example             # Template for Agent B credentials
    ├── index.js                 # LLM entry point, event listeners, NL instruction handler
    ├── modules/
        ├── LLMAgent.js              # Orchestrator: objective → ReAct loop → execute → replan
        ├── LLMMemory.js             # Context window: world snapshots, partner beliefs, change detection
        ├── LLMPlanner.js            # ReAct loop: LLM ↔ tool execution with retry and abort logic
        ├── LLMReplanner.js          # Monitors world changes and triggers replanning between turns
        └── LLMExecutor.js           # Tool implementations: move, pickup, A* navigation, PDDL solver
    ├── callModel.js             # OpenAI-compatible API wrapper with error handling
    ├── prompts/
    │   └── agentPrompt.js       # ReAct system prompt (dynamically generated from tools_index)
    └── tools/
        └── tools_index.js       # Single source of truth for tool descriptions
```

---

## Setup & Configuration

### Prerequisites

- **Node.js** 18+
- **Two Deliveroo tokens** (one per agent) — obtain from the game dashboard
- **LLM API access** — e.g. the UNITN LiteLLM server or an OpenAI-compatible endpoint

### 1. Install Dependencies

```bash
npm install
```

All dependencies are at the root level (`package.json`). No separate install inside agent directories is needed.

### 2. Configure Environment Files

Each agent has its own `.env` file. Copy the `.env.example` templates and fill in your credentials.

#### `BDI_Agent/.env`

```env
HOST=https://deliveroojs.bears.disi.unitn.it/
TOKEN=<your_agent_a_token>
```

| Variable | Required | Description |
|---|---|---|
| `HOST` | ✅ | Deliveroo game server URL |
| `TOKEN` | ✅ | Authentication token for Agent A |

#### `LLM_Agent/.env`

```env
HOST=https://deliveroojs.bears.disi.unitn.it/
TOKEN=<your_agent_b_token>

# LLM Configuration
LITELLM_BASE_URL=https://llm.bears.disi.unitn.it/v1
LITELLM_API_KEY=<your_api_key>
LOCAL_MODEL=llama-3.3-70b-lmstudio
```

| Variable | Required | Description |
|---|---|---|
| `HOST` | ✅ | Deliveroo game server URL |
| `TOKEN` | ✅ | Authentication token for Agent B |
| `LITELLM_BASE_URL` | ✅ | Base URL for the OpenAI-compatible LLM API |
| `LITELLM_API_KEY` | ✅ | API key for the LLM service |
| `LOCAL_MODEL` | ✅ | Model identifier (e.g. `llama-3.3-70b-lmstudio`, `gpt-4o`) |

> **Note**: The PDDL solver (`solver.planning.domains`) is free and requires no API key. It is called automatically by the `pddl_plan_route` tool.

### 3. Launch

#### Both agents together (recommended)

```bash
node main.js
```

This starts both agents in a single process, automatically exchanges their partner IDs, and enables inter-agent communication. Both agents connect to the game server with their respective tokens.

#### Agent A only (BDI)

```bash
cd BDI_Agent
node index.js
```

Runs the BDI agent standalone. It will collect and deliver parcels autonomously. Without a partner, coordination features are inactive.

#### Agent B only (LLM)

```bash
cd LLM_Agent
node index.js
```

Runs the LLM agent standalone. It starts collecting parcels autonomously on connection. You can send natural language instructions via the in-game chat to dynamically change its strategy.

---

## BDI Agent (Agent A)

### Architecture

- **Utility-Based Deliberation**: Evaluates all known parcels using `U = Reward − (TravelCost + DeliveryCost)` and picks the most profitable action. When carrying parcels, uses batch-aware detour cost analysis.
- **Dynamic Pathfinding**: A* algorithm (in `shared/pathfinding.js`) aware of dynamic obstacles (other agents, crates), arrow tile directional constraints, and Sokoban-style crate pushing.
- **Robustness**: All SDK actions wrapped in retry logic. Blocked delivery tiles are temporarily blacklisted so the agent tries alternative delivery points.

### BDI Cycle

1. **Sensing & Belief Revision** — Updates parcels/agents from server events. Parcels that should be visible but aren't are forgotten. Parcels outside FOV expire by temporal threshold.
2. **Deliberation** — If empty-handed, pick highest-utility parcel. If carrying, evaluate whether a detour for another parcel is profitable (multi-pickup). If nothing profitable, patrol spawn tiles.
3. **Planning** — A* path to target, converted to directional move sequence, with terminal pickup/putdown appended.
4. **Execution & Replanning** — Executes full plan in a loop. Replans if: target stolen, utility decayed below zero, or significantly better opportunity found. Retries blocked moves. Opportunistic pickup on passing. After 2 consecutive delivery failures, blacklists the target delivery tile and routes to the next nearest.

---

## LLM Agent (Agent B)

### Architecture

Four-component design following the course specification:

| Component | File | Role |
|---|---|---|
| **Memory** | `LLMMemory.js` | Context window: current objective, world state snapshot, partner beliefs, action history |
| **Planner** | `LLMPlanner.js` | ReAct loop: sends objective + world context to the LLM, parses Thought/Action/Observation, iterates |
| **Executor** | `LLMExecutor.js` | Maps tool names to game actions (socket calls, A* navigation, PDDL solver) |
| **Replanner** | `LLMReplanner.js` | Monitors world changes between turns; triggers immediate replanning if state diverged |

### Functional Levels (Challenge 2)

| Level | Capability | Implementation |
|---|---|---|
| **Level 1 — Atomic Requests** | Receive NL instruction, parse, execute | `socket.on("msg")` → `setObjective()` → ReAct turn |
| **Level 2 — Strategy Adaptation** | Receive higher-level objectives, adapt strategy | Same handler; objective updates the ReAct prompt context |
| **Level 3 — Coordination** | Exchange beliefs + intentions with Agent A | `MSG.beliefUpdate` / `MSG.intentionCommit` + `get_agent_a_intentions()` tool |

### Tool Set

| Tool | Description |
|---|---|
| `get_my_position()` | Returns agent's current `{x, y, score, carrying}` |
| `move(direction)` | Single-step move: `up`, `down`, `left`, `right` |
| `pick_up()` | Pick up all parcels on current tile |
| `put_down()` | Deliver carried parcels (must be on a delivery tile) |
| `plan_route(x, y)` | **Fast A* pathfinding** — computes optimal path and auto-executes all moves |
| `pddl_plan_route(x, y)` | **Online PDDL solver** — for complex logical constraints; falls back to A* on failure |
| `get_known_parcels()` | Returns all known uncollected parcels `[{id, x, y, reward}, ...]` |
| `get_delivery_tiles()` | Returns all delivery tile positions `[{x, y}, ...]` |
| `get_agent_a_intentions()` | Returns parcel IDs the BDI partner is pursuing (for conflict avoidance) |

> Tool descriptions are defined in `tools/tools_index.js` and automatically injected into the system prompt via `agentPrompt.js`.

### Planning Approach

The agent uses a **ReAct** (Reasoning + Acting) loop:
1. The LLM receives the system prompt + world context (JSON snapshot) + current objective
2. It outputs a `Thought:` (reasoning) and an `Action:` + `Action Input:` (tool call)
3. The executor runs the tool and returns the `Observation:` to the LLM
4. The loop repeats until `Final Answer:` or max iterations (30)
5. After each turn, the **Replanner** checks for world changes and triggers a follow-up turn if needed
6. A new turn is auto-scheduled after a 2-second cooldown, ensuring the agent is never idle

### PDDL Integration

- The `pddl_plan_route` tool calls the **online PDDL solver** at `solver.planning.domains` via `@unitn-asa/pddl-client`
- A PDDL domain with `move(agent, from, to)` actions and `at/adjacent` predicates is generated dynamically from the map
- The solver returns an optimal action sequence which is parsed and executed as directional moves
- If the solver fails or times out, A* is used as fallback
- For standard navigation, `plan_route` uses local A* directly (much faster)

### Natural Language Instructions

During gameplay, you can send messages to the LLM agent via the in-game chat. Examples:
- `"go pick up the parcel at position (3,4)"` — Level 1 atomic request
- `"prioritise high-reward parcels"` — Level 2 strategy adaptation
- `"pickup more than one parcel before delivering"` — Level 2 batch strategy

If the agent is mid-execution when a new instruction arrives, it **aborts the current turn** and immediately starts a new one with the updated objective.

---

## Inter-Agent Communication

### Protocol (`shared/common_protocol.js`)

Agents communicate via the Deliveroo SDK's `socket.emitSay(partnerId, message)` method. Three structured message types are defined:

| Message Type | Payload | Purpose |
|---|---|---|
| `belief_update` | `{ parcels: [...] }` | Share visible parcels with partner to extend effective FOV |
| `intention_commit` | `{ parcelId }` | Declare which parcel the agent is currently pursuing |
| `intention_clear` | `{}` | Release commitment (no active target) |

### Communication Flow

1. On each `sensing` event, each agent broadcasts its visible parcels to the partner via `belief_update` (with change detection to avoid spam).
2. After deliberation, the BDI agent broadcasts its chosen target via `intention_commit`.
3. When evaluating parcels, each agent's deliberation skips parcels that the partner has committed to.
4. Partner IDs are exchanged automatically by `main.js` after both agents connect.
5. Plain string messages (non-structured) are treated as natural language instructions for the LLM agent.

### Message Filtering

- Both agents **only accept structured protocol messages** from their registered partner (by ID).
- Natural language strings are accepted from **any sender** (user, mission-agent, etc.).
