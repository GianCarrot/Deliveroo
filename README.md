# Deliveroo Project

## Overview
This project implements a multi-agent system for the Deliveroo.js environment. The first agent is built using a BDI (Belief-Desire-Intention) architecture. It continuously senses the grid-based environment, builds a local representation of the world, and uses utility-based decision-making to efficiently navigate the map, collect parcels, and drop them off at designated delivery zones.
The second agent is built using a LLM (Large Language Model) architecture. It uses a LLM to plan and execute actions.

## BDI Agent

### Architectural Choices
- **BDI Architecture**: The agent strictly separates its internal state representation (**Beliefs**) from its goal evaluation (**Desires/Deliberation**) and its actionable sequences (**Intentions/Plans**).
- **Utility-Based Deliberation**: Instead of just picking the closest parcel, the agent evaluates all known parcels using a utility function: `U = Reward - (TravelCost + DeliveryCost)`. This ensures the agent prioritizes the most profitable actions.
- **Dynamic Pathfinding**: A custom implementation of the A* algorithm is used. It is aware of dynamic obstacles (automatically routing around other agents) and strictly respects map directional constraints (arrow tiles).
- **Robustness and Latency Compensation**: The agent interacts with a remote server via WebSockets. To handle network unreliability, all critical SDK actions (`emitMove`, `emitPickup`, `emitPutdown`) are wrapped in custom retry logic (`_retryableCall`). The execution loop operates aggressively, allowing the agent to perform multi-step operations (like moving and picking up) seamlessly without dropping the cycle.

### Directory Structure
```text
BDI_Agent/
├── .env                # Environment variables (Server URL, Authentication Tokens)
├── index.js            # Application entry point: initializes the socket, handles server events (config, map, sensing), and triggers the agent loop.
└── bdi/
    ├── agents.js       # Core BDIAgent class. Coordinates the BDI cycle: delegates to desires/intentions, handles replanning triggers, and runs the execution loop.
    ├── beliefs.js      # Beliefs class. Manages the agent's memory: parses the map, tracks parcels/agents, and implements "forgetting" logic.
    ├── desires.js      # Desires module. Evaluates the beliefs and computes utility scores to propose a set of prioritized goal candidates.
    ├── intentions.js   # Intentions module. Maps selected goals (pickParcel, deliverParcel, goToSpawn) to concrete actionable plans using A*.
    └── pathfinding.js  # A* search algorithm adapted for Deliveroo constraints (dynamic obstacles and one-way arrows).
```

### Operational Flow

#### 1. Sensing & Belief Revision
The system is driven by `sensing` events received from the server (handled in `index.js`). 
- On every tick, the agent updates its internal `Beliefs` with newly seen parcels and agents. 
- **Forgetting Logic**: The agent uses a sophisticated forgetting mechanism. If a previously seen parcel is expected to be in the current field of view but is no longer reported by the server, it is assumed stolen and removed from memory. Parcels outside the field of view expire based on a temporal threshold.
- The agent securely synchronizes its `carriedParcels` state directly against the server's authoritative payload to prevent desyncs.

### 2. Deliberation (Desires & Intentions)
When the agent does not have an active plan, the `deliberate()` method is invoked to form a new intention:
1. **Deliver / Multi-Pickup**: If the agent is currently carrying parcels, its primary goal is finding the nearest delivery zone (tile type `2`). However, it continuously evaluates whether a slight detour to pick up additional nearby high-reward parcels yields a positive net utility (`Reward - DetourCost > 0`). If so, it performs a multi-pickup sequence before delivering.
2. **Pick**: If empty-handed, the agent evaluates all parcels in its memory using `computeParcelUtility()`. Parcels held by other agents, or sitting on tiles currently occupied by other agents, are strictly ignored. The available parcel with the highest positive utility becomes the target of a `pickParcel` intention.
3. **Patrol Spawn Zones**: If no profitable parcels are known, the agent defaults to a `goToSpawn` intention. Instead of random wandering, it continuously patrols between reachable spawn tiles (tile type `1`) to maximize the chances of discovering newly spawned parcels.

### 3. Planning
Once an intention is formed, the `planFor()` method generates a sequence of actions:
- It calls the `aStar` function (`pathfinding.js`) to find the shortest valid path to the target.
- It translates the coordinate path into a sequence of directional `"move"` actions.
- It appends terminal actions (`"pickup"` or `"putdown"`) at the end of the plan depending on the intention.

### 4. Execution & Replanning
The `step()` method is the heart of the agent, executing the generated plan in a continuous high-performance loop:
- **Replanning Triggers**: Before taking a step, `shouldReplan()` verifies if the current plan is still valid. The plan is aborted if:
  - The target parcel has been stolen by another agent.
  - The target parcel's utility has decayed below zero.
  - A significantly better opportunity (a new parcel with much higher utility) has been discovered.
- **Action Execution**: The agent processes `executePlanStep()`. 
  - **Dynamic Obstacle Handling**: If a movement is blocked by another agent, instead of abandoning the plan immediately, the agent waits and retries briefly (up to 3 times), as the blocking agent is likely to move.
  - **Opportunistic Pickup**: After every successful movement step, the agent checks if it landed on a tile with uncollected parcels and picks them up instantly for "free," without requiring a detour or utility evaluation.
- **Immediate Re-evaluation**: Upon successfully completing a terminal action (`pickup`/`putdown`), the loop immediately clears the intention and loops back to deliberation. This prevents the agent from sitting idle waiting for the next server sensing event, drastically increasing delivery throughput.

## LLM Agent

