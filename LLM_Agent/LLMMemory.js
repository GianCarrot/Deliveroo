export class LLMMemory {
  constructor(bdi) {
    this.bdi = bdi;              // BDI agent
    this.objective = null;       // Natural Language prompt
    this.worldSnapshot = null;   // World state copy
    this.history = [];
  }

  updateWorld() {
    const beliefs = this.bdi.beliefs ?? {};
    this.worldSnapshot = JSON.parse(JSON.stringify(beliefs));
  }

  hasWorldChanged() {
    if (!this.worldSnapshot) 
      return false;
    const now = this.bdi.beliefs ?? {};
    
    const prevParcels = this.worldSnapshot.parcels ?? [];
    const nowParcels = now.parcels ?? [];

    if (prevParcels.length !== nowParcels.length) return true;

    return false;
  }
}
