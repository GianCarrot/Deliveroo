export function aStar(start, goal, beliefs) {

    const key = (x, y) => `${x},${y}`;

    const open = new Set([key(start.x, start.y)]);
    const cameFrom = new Map();

    const g = new Map();
    g.set(key(start.x, start.y), 0);

    const f = new Map();
    f.set(key(start.x, start.y), heuristic(start, goal));

    function heuristic(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }

    function neighbors(x, y) {
        const dirs = [
            [1, 0], [-1, 0],
            [0, 1], [0, -1]
        ];

        return dirs
            .map(([dx, dy]) => [x + dx, y + dy])
            .filter(([nx, ny]) =>
                nx >= 0 &&
                ny >= 0 &&
                nx < beliefs.mapWidth &&
                ny < beliefs.mapHeight &&
                beliefs.walkableTiles.has(key(nx, ny))
            );
    }

    while (open.size > 0) {

        // nodo con f più basso
        let current = null;
        let bestF = Infinity;

        for (const k of open) {
            const val = f.get(k) ?? Infinity;
            if (val < bestF) {
                bestF = val;
                current = k;
            }
        }

        const [cx, cy] = current.split(",").map(Number);

        if (cx === goal.x && cy === goal.y) {
            // ricostruisci percorso
            const path = [];
            let cur = current;

            while (cameFrom.has(cur)) {
                const [px, py] = cur.split(",").map(Number);
                path.push({ x: px, y: py });
                cur = cameFrom.get(cur);
            }

            path.reverse();
            return path;
        }

        open.delete(current);

        for (const [nx, ny] of neighbors(cx, cy)) {
            const nk = key(nx, ny);
            const tentativeG = (g.get(current) ?? Infinity) + 1;

            if (tentativeG < (g.get(nk) ?? Infinity)) {
                cameFrom.set(nk, current);
                g.set(nk, tentativeG);
                f.set(nk, tentativeG + heuristic({ x: nx, y: ny }, goal));
                open.add(nk);
            }
        }
    }

    return null;
}