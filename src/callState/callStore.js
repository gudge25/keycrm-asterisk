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
      this._remove(id);
    }, CLEANUP_DELAY_MS);
    timer.unref();
  }

  countActive() {
    let count = 0;
    for (const record of this.byId.values()) {
      if (ACTIVE_STATES.has(record.state)) count += 1;
    }
    return count;
  }

  // Safety net for records that never reach a terminal state via normal AMI
  // events (e.g. a Newchannel that never correlates, or a dropped/missed
  // event) — without this, such a record and its index entries would stay
  // in memory forever. Call periodically via startStaleSweep().
  pruneStale(maxAgeMs, logger) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, record] of this.byId) {
      if (record.createdAt < cutoff) {
        if (logger) logger.warn('callStore.pruned_stale', { id, state: record.state, ageMs: Date.now() - record.createdAt });
        this._remove(id);
      }
    }
    for (const [ext, id] of this.pendingOriginates) {
      if (!this.byId.has(id)) this.pendingOriginates.delete(ext);
    }
  }

  startStaleSweep({ maxAgeMs, intervalMs, logger }) {
    const timer = setInterval(() => this.pruneStale(maxAgeMs, logger), intervalMs);
    timer.unref();
    return timer;
  }

  _remove(id) {
    const record = this.byId.get(id);
    if (record && record.linkedid) this.linkedidIndex.delete(record.linkedid);
    this.byId.delete(id);
  }
}

module.exports = { CallStore, ACTIVE_STATES };
