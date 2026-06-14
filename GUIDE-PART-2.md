# REQUIREMENTS – PART 2: LLM Agent & Project Extension
> Source: `6-F-Project-Presentation-2-MB.pdf` + `Exam-Project-info.pdf`
> Course: Autonomous Software Agents – A.A. 2025-2026, University of Trento

---

## 1. Project Overview

The project requires developing a **team of two coordinated autonomous agents** for the Deliveroo.js game:

- **Agent A** – BDI agent (already implemented in Part 1)
- **Agent B** – LLM-based agent (second part, this document)
- Both agents must **communicate and coordinate** with each other and with a *mission-agent*
- PDDL planning must be integrated into Agent A and/or Agent B

**Deliverable:** JavaScript code + PDF report (max 10 pages) + oral presentation (10 min + 20 min Q&A)

---

## 2. Deliveroo.js Game – Quick Reference

### Environment
- Grid **M×N** tiles: `0` = non-walkable, `1` = parcel-spawning (green), `2` = delivery (red), `3` = walkable (white)
- Parcels: appear at `(x,y)` with a countdown timer; disappear on delivery or timeout

### Player Actions
`move_right`, `move_left`, `move_up`, `move_down`, `pick_up`, `put_down`

### Sensing (limited range: `x_offset + y_offset < 5`)
- **Parcel:** `{ id, x, y, carriedBy, reward }`
- **Agent:** `{ id, name, x, y, score }`
- **Self:** `{ id, name, x, y, score, penalty }`

### Architecture
```
Game Server (Node.js + Socket.IO)
    ├── DeliverooAgent.js  ← Agent A (BDI) + Agent B (LLM)  [WebSocket]
    └── DeliverooThree.js  ← 3D browser client (testing)    [WebSocket]
```
- Cloud: `https://deliveroojs.azurewebsites.net/` or UNITN internal (VPN required)
- Local: `git clone https://github.com/unitn-ASA/DeliverooAgent.js` → `npm install` → edit `host` + `token` in `config.js` → `node demo_agent_client.js`

---

## 3. LLM Agent – What It Is

An **LLM-based agent** uses a Large Language Model to:
1. **Reason** through a problem
2. **Create a plan** (sequence of tool calls) to solve it
3. **Execute** the plan and **replan** dynamically when the environment changes

### Required Components

| Component | Description |
|---|---|
| **LLM Memory** | The LLM context window: holds current objective (natural language) + environment observations from game sensing + shared beliefs from Agent A |
| **LLM Planner** | Decomposes the NL objective into an ordered sequence of tool calls. Can use Chain-of-Thought, Reflexion, etc. |
| **LLM Replanner** | Monitors execution; triggers re-planning if environment changes or objective is updated. Techniques: ReAct, Reflexion, Chain-of-Thought |
| **Tools** | Predefined set of callable actions (available on course server via API); Agent B queries them to interact with the game |

### Architecture (from slides)
```
New Objective (NL)
        ↓
[LLM Memory] ──→ [Planner] ──→ PLAN (a1, a2, … aN)
     ↑                                    ↓
Game ENV ←──────────────── [Exec] ──→ [Replan?]
                            ↑              │ YES → back to Memory
                          Tools            │ NO  → continue
```

---

## 4. LLM Agent – Functional Requirements (Challenge 2)

### Level 1 – Atomic Requests
- Receive a single NL instruction (e.g., "go pick up the parcel at position (3,4)")
- Parse it, map to a tool sequence, execute

### Level 2 – Strategy Adaptation
- Receive higher-level NL objectives (e.g., "prioritise high-reward parcels")
- Dynamically adapt game strategy accordingly

### Level 3 – Coordination with Agent A
- Exchange **beliefs** with the BDI Agent A: positions, environment observations outside own sensing range, committed intentions
- **Coordinate activities**: e.g., the closest agent commits to picking up a new parcel
- Communicate with the **mission-agent** (external coordinator)

---

## 5. LLM Agent Implementation

To implement the LLM agent, you need an execution loop, proper tool setup, and prompt engineering. The LLM must be integrated with the Deliveroo.js socket client to perceive the environment and act.

### Prompt Design
Use an explicit format for reasoning (e.g., ReAct style) specifying available tools and how to respond. A prompt consists of context, tool descriptions, and strict output formatting rules.

```javascript
const AGENT_PROMPT = `
You are an AI agent connected to a DeliverooJS environment.

Available tools:
- get_my_position(): returns the agent's current x, y coordinates and score
- move(direction): moves the agent one step in one direction: up, down, left, or right
- pick_up(): picks up a parcel on the current tile
- put_down(): drops a parcel on the current delivery tile

STRICT OUTPUT FORMAT — choose exactly one format.

FORMAT 1 — use one tool:
Thought: <brief reasoning>
Action: <tool name>
Action Input: <tool input>

FORMAT 2 — final answer:
Thought: I have enough information to answer.
Final Answer: <clear final answer for the user>

Rules:
- Output exactly one action at a time.
- If the user asks to move, call move once for each step.
- Only give Final Answer when all required tool results have been observed.
`;
```

### Tools Implementation
Tools map LLM actions directly to Deliveroo SDK calls:

```javascript
const TOOLS = {
  get_my_position: async () => JSON.stringify(me),
  move: async (direction) => {
    try {
      const result = await socket.emitMove(direction);
      return result ? `Successfully moved ${direction}` : `Failed to move`;
    } catch (e) { return `Error: ${e.message}`; }
  },
  pick_up: async () => {
    try {
      const result = await socket.emitPickup();
      return result ? `Picked up parcel` : `Failed to pick up`;
    } catch (e) { return `Error: ${e.message}`; }
  }
};
```

### Perception Loop & Action Selection
The agent runs in a loop, asking the LLM what to do next based on observations, and executing the chosen tool.

```javascript
async function runAgentTurn(userInput, maxIterations = 10) {
  let messages = [
    { role: "system", content: AGENT_PROMPT },
    { role: "user", content: userInput }
  ];

  for (let i = 0; i < maxIterations; i++) {
    const response = await callModel(messages);
    messages.push({ role: "assistant", content: response });

    // Parse model output
    const actionMatch = response.match(/^Action:\s*(.+)$/im);
    const actionInputMatch = response.match(/^Action Input:\s*(.+)$/im);
    
    if (actionMatch && actionInputMatch) {
      const action = actionMatch[1].trim();
      const actionInput = actionInputMatch[1].trim();
      
      const observation = TOOLS[action] 
        ? await TOOLS[action](actionInput)
        : `Error: unknown tool '${action}'`;
        
      messages.push({ role: "user", content: `Observation: ${observation}` });
      continue; // Re-prompt LLM with the observation
    }

    const finalAnswerMatch = response.match(/^Final Answer:\s*([\s\S]*)$/im);
    if (finalAnswerMatch) {
      return finalAnswerMatch[1].trim(); // Task complete
    }
  }
}
```

---

## 6. BDI ↔ LLM Integration

The two agents must be able to:
- **Share beliefs**: each agent has a limited sensing range; sharing extends the effective view of the environment.
- **Avoid conflicts**: if Agent A is already committed to a parcel, Agent B should not duplicate the intention.
- **Coordinate strategy**: mission-agent can issue objectives that require joint action.

### Message Formats and Communication
Use the Deliveroo `socket.emitSay()` method for agents to communicate JSON payloads locally.
Agent A (BDI) maintains a `Beliefset` and `PlanLibrary`. Agent B (LLM) maintains context via its conversation memory.

**Agent A sending a belief update:**
```javascript
// Agent A (BDI) inside its perception cycle
await socket.emitSay('agent-b-id', {
  type: 'belief_update',
  entity: 'parcel',
  payload: { id: 'p1', x: 5, y: 5, reward: 10, carriedBy: null }
});
```

**Agent B receiving updates:**
```javascript
// Agent B (LLM) updating memory
socket.onSay((message) => {
  if (message.type === 'belief_update') {
    // Incorporate directly into the LLM context or a local state object
    // that tools like get_known_parcels() can read.
    updateLLMMemory(message.entity, message.payload);
  }
});
```

### Intention Coordination
Before committing to a parcel, Agent A checks if Agent B is already pursuing it, and vice versa.

```javascript
// Agent A broadcasting intention
await socket.emitSay('agent-b-id', {
  type: 'intention_commit',
  payload: { parcelId: 'p1', action: 'pickup' }
});

// Agent B reading intentions via a tool
const TOOLS = {
  get_agent_a_intentions: async () => JSON.stringify(agentAIntentions)
};
```

---

## 7. API Setup & Configuration

### `.env` file structure
Properly configure endpoints and keys. When using OpenAI or compatible models (like LiteLLM or local servers), keep cost and token usage in mind.

```env
# Deliveroo Server
DELIVEROOJS_URL=https://deliveroojs.azurewebsites.net
DELIVEROOJS_TOKEN=<your_token>

# LLM Configuration
LITELLM_BASE_URL=https://llm.bears.disi.unitn.it/v1
LITELLM_API_KEY=<your_api_key>
LOCAL_MODEL=llama-3.3-70b-lmstudio
OPENAI_API_KEY=<fallback_openai_key>

# Planning Server
PDDL_SOLVER_URL=http://solver.planning.domains/solve
```

### Initialising the client and Error Handling
Ensure robustness by wrapping tool execution and API calls in `try/catch`. 

```javascript
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const client = new OpenAI({
  baseURL: process.env.LITELLM_BASE_URL,
  apiKey: process.env.LITELLM_API_KEY || process.env.OPENAI_API_KEY,
});

async function callModel(messages, options = { temperature: 0 }) {
  try {
    const response = await client.chat.completions.create({
      model: process.env.LOCAL_MODEL || 'gpt-4o',
      messages,
      ...options
    });
    return response.choices[0]?.message?.content ?? "";
  } catch (error) {
    console.error("LLM API Error:", error.message);
    return "Error: Unable to process request.";
  }
}
```

### Cost and Token Considerations
- **Tokens**: Pass only relevant parts of the map/beliefs to the LLM to save tokens and improve speed.
- **Max Iterations**: Hardcode limits in your execution loops (`maxIterations`) to prevent infinite reasoning loops which rapidly consume API credits.

---

## 8. PDDL Planning in the LLM Agent

- Must be used in **Agent A and/or Agent B**
- When an intention is activated, the agent calls the **online PDDL solver** to obtain the plan
- The returned plan (sequence of actions) is injected into the BDI `PlanLibrary` or into the LLM tool-execution pipeline

### When to invoke PDDL in the LLM
Provide the LLM with a `plan_route(target_x, target_y)` tool. Instead of the LLM generating step-by-step moves, it invokes the PDDL solver to generate an optimal path, saving LLM iterations and tokens.

### Implementation Example
```javascript
import { onlineSolver, PddlProblem, Beliefset, PddlDomain, PddlAction } from "@unitn-asa/pddl-client";

// Tool exposed to the LLM
const TOOLS = {
  plan_route: async (targetPos) => {
    // 1. Pass beliefs as PDDL facts
    const myBeliefset = new Beliefset();
    myBeliefset.declare(`at a1 t_${me.x}_${me.y}`);
    myBeliefset.declare(`delivery t_${targetPos.x}_${targetPos.y}`);
    // Add map connectivity facts here...

    const problem = new PddlProblem(
      'deliveroo',
      myBeliefset.objects.join(' '),
      myBeliefset.toPddlString(),
      `and (at a1 t_${targetPos.x}_${targetPos.y})`
    ).toPddlString();

    const domain = myPddlDomain.toPddlString(); // Define your PDDL domain

    // 2. Invoke Solver
    const plan = await onlineSolver(domain, problem);
    
    if (!plan) return "Error: No valid path found.";
    
    // 3. Parse the returned plan into LLM instructions or execute directly
    return `Plan found: ${plan.map(p => p.action).join(', ')}`;
  }
};
```

### Minimal PDDL problem structure (Deliveroo.js)
```pddl
(:domain deliveroo)
;; Types: tile, parcel, agent
;; Predicates: at(?a - agent, ?t - tile), has(?a, ?p - parcel),
;;             adjacent(?t1, ?t2), is_delivery(?t), parcel_at(?p, ?t)
;; Actions: move, pick_up, put_down
```

---

## 9. Exam Evaluation Criteria

| Criterion | Weight |
|---|---|
| BDI Agent – belief revision, intention revision, game strategy, code quality | 30% |
| LLM Agent – atomic requests, strategy adaptation, coordination | 30% |
| PDDL – integration and problem complexity | 20% |
| Report + oral presentation clarity | 20% |

### Submission deadlines
| Exam date | Submission deadline |
|---|---|
| 22/06 | 17/06 |
| 14/07 | 10/07 |
| 09/09 | 04/09 |

Report must include: **Name, Surname, email, Matricola** for all group members.

---

## 10. Key Resources

| Resource | URL |
|---|---|
| Game (cloud) | https://deliveroojs.azurewebsites.net/ |
| Game (UNITN, VPN) | https://deliveroojs.bears.disi.unitn.it/ |
| Game source | https://github.com/unitn-ASA/Deliveroo.js |
| Agent starter | https://github.com/unitn-ASA/DeliverooAgent.js |
| Course platform | Moodle (lectures, challenge scenarios, tool catalog) |
