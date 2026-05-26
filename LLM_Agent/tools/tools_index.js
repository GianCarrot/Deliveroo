/**
 * Tool descriptions for the LLM agent — used in prompt construction
 * and as a reference for the ReAct agent's available actions.
 */
export const TOOL_DESCRIPTIONS = {
    get_my_position:
        "Return the agent's current position (x, y), score, and number of carried parcels.",
    move: "Move the agent one step in a direction: up, down, left, right.",
    pick_up: "Pick up parcels at the current position.",
    put_down: "Drop all carried parcels at the current position (must be a delivery tile).",
    plan_route:
        "Fast local A* pathfinding: compute the optimal path to target coordinates (x, y) and execute the movement automatically. Use for all standard navigation.",
    pddl_plan_route:
        "Online PDDL solver: compute an optimal path to target coordinates (x, y) using the remote PDDL solver. Slower but handles complex logical constraints. Falls back to A* on failure.",
    get_known_parcels:
        "Return the list of all known uncollected parcels with their positions and rewards.",
    get_delivery_tiles: "Return the list of all known delivery tile positions.",
    get_agent_a_intentions:
        "Return the set of parcel IDs that the partner BDI Agent A is currently pursuing.",
};