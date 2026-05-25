# Deliveroo Multi-Agent System

## Overview
This project implements a team of two coordinated autonomous agents for the Deliveroo.js environment:
- **Agent A** — BDI (Belief-Desire-Intention) architecture
- **Agent B** — LLM-based agent using a Large Language Model for planning

Both agents connect independently to the game server with separate sockets and tokens. They communicate via `socket.emitSay()` / `socket.on('msg')` to share beliefs and coordinate intentions, avoiding conflicts when pursuing parcels.

## Project Structure
```text
deliveroo/
├── main.js                      # Multi-agent launcher (starts both agents)
├── package.json                 # Root dependencies (pddl-client, openai, dotenv)
├── shared/
│   └── common_protocol.js       # Message types & factories for inter-agent communication
├── BDI_Agent/
│   ├── .env                     # Agent A credentials (HOST, TOKEN)
│   ├── index.js                 # BDI entry point + communication handlers
│   └── bdi/
│       ├── agents.js            # BDIAgent class: BDI cycle, partner tracking
│       ├── beliefs.js           # Beliefs: map, parcels, agents, forgetting logic
│       ├── desires.js           # Utility-based goal evaluation + partner filtering
│       ├── intentions.js        # Goal → action plan mapping via A*
│       └── pathfinding.js       # A* with arrow tiles and dynamic obstacles
└── LLM_Agent/
    ├── .env                     # Agent B credentials (HOST, TOKEN, LLM API keys)
    ├── index.js                 # LLM entry point + communication handlers
    ├── LLMAgent.js              # Orchestrator: objective → plan → execute → replan
    ├── LLMMemory.js             # World state snapshots, change detection
    ├── LLMPlanner.js            # Calls LLM API to generate a tool-call plan
    ├── LLMReplanner.js          # Triggers replanning on world change or failure
    ├── LLMExecutor.js           # Maps tool calls to socket actions (move, pickup, etc.)
    ├── prompts/
    │   └── plannerPrompt.js     # System prompt for the planning LLM
    └── tools/
        └── tools_index.js       # Tool description catalog
```

## Running

### Prerequisites
- Node.js 18+
- Two Deliveroo tokens (one per agent)
- Access to the LLM API endpoint

### Setup
```bash
npm install                          # Install root dependencies
cd BDI_Agent && npm install && cd .. # Install BDI SDK dependency
```

Configure each agent's `.env` file:

**`BDI_Agent/.env`**
```env
HOST=https://deliveroojs.bears.disi.unitn.it/
TOKEN=<agent_a_token>
```

**`LLM_Agent/.env`**
```env
HOST=https://deliveroojs.bears.disi.unitn.it/
TOKEN=<agent_b_token>
LITELLM_BASE_URL=https://llm.bears.disi.unitn.it/v1
LITELLM_API_KEY=<your_api_key>
LOCAL_MODEL=llama-3.3-70b-lmstudio
```

### Start both agents together
```bash
node main.js
```

### Run agents independently (no communication)
```bash
node BDI_Agent/index.js   # Agent A only
node LLM_Agent/index.js   # Agent B only
```

---

## BDI Agent (Agent A)

### Architecture
- **Utility-Based Deliberation**: Evaluates all known parcels using `U = Reward - (TravelCost + DeliveryCost)` and picks the most profitable action.
- **Dynamic Pathfinding**: A* algorithm aware of dynamic obstacles (other agents) and map directional constraints (arrow tiles).
- **Robustness**: All SDK actions (`emitMove`, `emitPickup`, `emitPutdown`) wrapped in retry logic for network unreliability.

### BDI Cycle
1. **Sensing & Belief Revision** — Updates parcels/agents from server events. Parcels that should be visible but aren't are forgotten. Parcels outside FOV expire by temporal threshold.
2. **Deliberation** — If empty-handed, pick highest-utility parcel. If carrying, evaluate whether a detour for another parcel is profitable (multi-pickup). If nothing profitable, patrol spawn tiles.
3. **Planning** — A* path to target, converted to directional move sequence, with terminal pickup/putdown appended.
4. **Execution & Replanning** — Executes full plan in a loop. Replans if: target stolen, utility decayed below zero, or significantly better opportunity found. Retries blocked moves. Opportunistic pickup on passing.

---

## LLM Agent (Agent B)

### Architecture
Four-component design following the course specification:

| Component | File | Role |
|---|---|---|
| **Memory** | `LLMMemory.js` | Stores the current objective, world state snapshot, and action history |
| **Planner** | `LLMPlanner.js` | Sends objective + world state to the LLM API, receives a JSON plan (array of tool calls) |
| **Executor** | `LLMExecutor.js` | Executes each tool call against the game server via the socket |
| **Replanner** | `LLMReplanner.js` | Detects world changes or action failures and triggers a new plan |

### Tool Set
- `moveTo(x, y)` — A* pathfinding + sequential move execution
- `move(direction)` — Single-step directional move (up/down/left/right)
- `pickup()` — Pick up parcels at current position
- `putdown()` — Deliver parcels at current position
- `get_my_position()` — Returns agent's current coordinates and score

### Planning Approach
The LLM receives a structured prompt with world state (JSON) and available tools. It returns a complete plan as a JSON array of `{ tool, args }` steps. The plan is executed sequentially; if the world changes mid-execution, the replanner generates a fresh plan.

---

## Inter-Agent Communication

### Protocol (`shared/common_protocol.js`)
Agents communicate via the Deliveroo SDK's `socket.emitSay(partnerId, message)` method. Three message types are defined:

| Message Type | Payload | Purpose |
|---|---|---|
| `belief_update` | `{ parcels: [...] }` | Share visible parcels with partner to extend effective FOV |
| `intention_commit` | `{ parcelId }` | Declare which parcel the agent is currently pursuing |
| `intention_clear` | `{}` | Release commitment (no active target) |

### Flow
1. On each `sensing` event, each agent broadcasts its visible parcels to the partner via `belief_update`.
2. After deliberation, the BDI agent broadcasts its chosen target via `intention_commit`.
3. When evaluating parcels, each agent's deliberation skips parcels that the partner has committed to.
4. Partner IDs are exchanged automatically by `main.js` after both agents connect.
