export function getDesires(agent) {
    const candidates = [];
    const beliefs = agent.beliefs;
    const parcels = beliefs.parcels || [];
    const isCarrying = beliefs.carriedCount > 0 || beliefs.me.carrying > 0;
    const myPos = { x: Math.round(beliefs.me.x), y: Math.round(beliefs.me.y) };

    // Pre-compute carried reward and delivery cost from current position
    let carriedReward = 0;
    if (isCarrying) {
        for (const p of parcels) {
            if (beliefs.carriedParcels.includes(p.id)) {
                carriedReward += p.reward;
            }
        }
    }
    const myNearestDelivery = agent.getNearestDeliveryTile();
    const myDeliveryCost = myNearestDelivery
        ? agent.manhattan(myPos, myNearestDelivery) : Infinity;

    // Pre-compute agent-occupied cells for quick lookup
    const agentOccupied = new Set();
    for (const ag of beliefs.agentsMap.values()) {
        agentOccupied.add(`${Math.round(ag.x)},${Math.round(ag.y)}`);
    }

    // 1. Evaluate all uncarried parcels for pickup
    for (const p of parcels) {
        if (p.carriedBy) continue;

        // Skip parcels that partner has committed to
        if (agent.partnerIntentions.has(p.id)) continue;

        const parcelPos = { x: Math.round(p.x), y: Math.round(p.y) };

        // Skip parcels on tiles occupied by other agents (likely being picked up)
        if (agentOccupied.has(`${parcelPos.x},${parcelPos.y}`)) continue;
        const travelCost = agent.manhattan(myPos, parcelPos);
        const deliveryFromParcel = agent._nearestDeliveryFrom(parcelPos);
        const deliveryCostFromParcel = deliveryFromParcel
            ? agent.manhattan(parcelPos, deliveryFromParcel) : Infinity;

        if (isCarrying) {
            // Multi-pickup: is the detour to pick up this parcel worth it?
            // detourCost = extra distance added vs going straight to delivery
            const detourCost = travelCost + deliveryCostFromParcel - myDeliveryCost;
            const netGain = p.reward - Math.max(0, detourCost);

            if (netGain > 0) {
                // Utility = total value of "pick up + deliver all together"
                const U = carriedReward + p.reward - (travelCost + deliveryCostFromParcel);
                candidates.push({ type: "pickParcel", target: p, utility: U });
            }
        } else {
            // Standard: parcel reward vs travel + delivery cost
            const U = p.reward - (travelCost + deliveryCostFromParcel);
            if (U > 0) {
                candidates.push({ type: "pickParcel", target: p, utility: U });
            }
        }
    }

    // 2. Evaluate delivery if we carry anything
    if (isCarrying && myNearestDelivery) {
        const uDelivery = carriedReward - myDeliveryCost;
        if (uDelivery > 0) {
            candidates.push({ type: "deliverParcel", utility: uDelivery });
        } else {
            // Fallback to guarantee we eventually deliver if we carry stuff
            candidates.push({ type: "deliverParcel", utility: 1 });
        }
    }

    if (candidates.length === 0) {
        candidates.push({ type: "goToSpawn", utility: 0 });
    }

    return candidates;
}