export class LLMExecutor {
    constructor(bdi) {
        this.bdi = bdi;  
    }

    async execute(tool, ...args) {
        switch (tool) {
            case "moveTo":
                return await this.bdi.moveTo(...args);

            case "move":
                return await this.bdi.move(...args);

            case "pickup":
                return await this.bdi.pickup();

            case "putdown":
                return await this.bdi.putdown();

            case "get_my_position":
                return JSON.stringify({
                    x: this.bdi.beliefs?.me?.x,
                    y: this.bdi.beliefs?.me?.y,
                    score: this.bdi.beliefs?.me?.score,
                });

            default:
                throw new Error(`Unknown tool '${tool}'`);
        }
    }
}
