const ACTIVE_STATES = new Set(['started', 'pending', 'answered']);
const CLEANUP_DELAY_MS = 30000;

class CallStore {
  constructor() {
    this.byId = new Map();
    this.linkedidIndex = new Map();
    // extension -> record id, for correlating an outgoing Originate's
    // resulting Newchannel before a Linkedid is known.
    this.pendingOriginates = new Map();
  }

  create(record) {
    this.byId.set(record.id, record);
    return record;
  }

  getById(id) {
    return id ? this.byId.get(id) : undefined;
  }

  getByLinkedid(linkedid) {
    const id = this.linkedidIndex.get(linkedid);
    return id ? this.byId.get(id) : undefined;
  }

  attachLinkedid(id, linkedid) {
    this.linkedidIndex.set(linkedid, id);
  }

  findActiveByCallerOrDestination({ caller, destinationNumber }) {
    for (const record of this.byId.values()) {
      if (!ACTIVE_STATES.has(record.state)) continue;
      if ((caller && record.caller === caller) || (destinationNumber && record.destinationNumber === destinationNumber)) {
        return record;
      }
    }
    return undefined;
  }

  scheduleCleanup(id) {
    const timer = setTimeout(() => {
      const record = this.byId.get(id);
      if (record && record.linkedid) this.linkedidIndex.delete(record.linkedid);
      this.byId.delete(id);
    }, CLEANUP_DELAY_MS);
    timer.unref();
  }
}

module.exports = { CallStore, ACTIVE_STATES };
