export function getDesires(agent) {
    const candidates = [];
    const beliefs = agent.beliefs;
    const parcels = beliefs.parcels || [];

    // 1. Evaluate all uncarried parcels for pickup
    for (const p of parcels) {
        if (p.carriedBy) continue;
        const U = agent.computeParcelUtility(p);
        if (U > 0) {
            candidates.push({ type: "pickParcel", target: p, utility: U });
        }
    }

    // 2. Evaluate delivery if we carry anything
    if (beliefs.carriedCount > 0 || beliefs.me.carrying > 0) {
        const nearestDelivery = agent.getNearestDeliveryTile();
        if (nearestDelivery) {
            let totalReward = 0;
            for (const p of parcels) {
                if (beliefs.carriedParcels.includes(p.id)) {
                    totalReward += p.reward;
                }
            }
            const myPos = { x: Math.round(beliefs.me.x), y: Math.round(beliefs.me.y) };
            const deliveryCost = agent.manhattan(myPos, nearestDelivery);
            const uDelivery = totalReward - deliveryCost;

            if (uDelivery > 0) {
                candidates.push({ type: "deliverParcel", utility: uDelivery });
            } else {
                // Fallback to guarantee we eventually deliver if we carry stuff
                candidates.push({ type: "deliverParcel", utility: 1 });
            }
        }
    }

    if (candidates.length === 0) {
        candidates.push({ type: "wander", utility: 0 });
    }

    return candidates;
}