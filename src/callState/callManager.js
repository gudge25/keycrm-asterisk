const crypto = require('crypto');
const { nextState } = require('./stateMachine');
const { extractExtension, extractDialedExtension, isValidExtension } = require('../util/extension');
const { normalizePhone } = require('../util/phone');
const { buildOriginateAction, buildHangupAction } = require('../ami/originate');

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 404;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

class TooManyCallsError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 503;
  }
}

class CallManager {
  constructor({ ami, store, webhookClient, logger, config }) {
    this.ami = ami;
    this.store = store;
    this.webhookClient = webhookClient;
    this.logger = logger;
    this.config = config;

    this.ami.onEvent((evt) => this._onAmiEvent(evt));
  }

  // --- HTTP-facing API -----------------------------------------------

  async startOutgoingCall({ caller, destinationNumber }) {
    const { extensionLength, originateChannelTemplate, originateContext, originateTimeoutMs, maxConcurrentCalls } = this.config.call;

    if (!isValidExtension(caller, extensionLength)) {
      throw new ValidationError(`caller must be a ${extensionLength}-digit extension`);
    }
    const destination = normalizePhone(destinationNumber);
    if (!destination) {
      throw new ValidationError('destination_number is required');
    }

    // Fail closed before ever touching AMI: a bug, retry storm, or leaked
    // token on KeyCRM's side shouldn't be able to flood Asterisk with
    // channel-creation requests.
    const activeCount = this.store.countActive();
    if (activeCount >= maxConcurrentCalls) {
      this.logger.warn('call.rejected_too_many_active', { activeCount, maxConcurrentCalls });
      throw new TooManyCallsError('too many concurrent calls, try again later');
    }

    const id = crypto.randomUUID();
    const record = this.store.create({
      id,
      direction: 'outgoing',
      caller,
      destinationNumber: destination,
      state: 'started',
      linkedid: null,
      agentChannel: null,
      trunkChannel: null,
      answeredAt: null,
      createdAt: Date.now(),
    });

    this.store.pendingOriginates.set(caller, id);

    const action = buildOriginateAction({
      actionId: id,
      caller,
      destinationNumber: destination,
      channelTemplate: originateChannelTemplate,
      context: originateContext,
      timeoutMs: originateTimeoutMs,
    });

    let response;
    try {
      response = await this.ami.action(action);
    } catch (err) {
      this.store.pendingOriginates.delete(caller);
      this.store.byId.delete(id);
      const error = new Error(`AMI originate failed: ${err.message}`);
      error.statusCode = 503;
      throw error;
    }

    this.logger.info('call.originated', { id, caller, destination, amiResponse: response.response });
    this._report(record);

    // If Newchannel never arrives to correlate this call (e.g. the
    // extension never actually rings — offline phone, bad channel string),
    // nothing would otherwise move it out of 'started', leaking the record
    // and the pendingOriginates entry forever. Clear it out and report a
    // terminal state once the originate timeout has clearly passed.
    const expireTimer = setTimeout(
      () => this._expireUncorrelatedOriginate(id, caller),
      originateTimeoutMs + 5000
    );
    expireTimer.unref();

    return { id };
  }

  _expireUncorrelatedOriginate(id, caller) {
    if (this.store.pendingOriginates.get(caller) !== id) return; // already correlated or already gone
    this.store.pendingOriginates.delete(caller);
    const record = this.store.getById(id);
    if (!record) return;
    this.logger.warn('call.originate_never_correlated', { id, caller });
    this._transition(record, 'canceled');
    this.store.scheduleCleanup(id);
  }

  async endCall({ id, caller, destinationNumber }) {
    const destination = destinationNumber ? normalizePhone(destinationNumber) : undefined;
    const record = this.store.getById(id) || this.store.findActiveByCallerOrDestination({ caller, destinationNumber: destination });
    if (!record) {
      throw new NotFoundError('no active call found');
    }

    const channel = record.agentChannel || record.trunkChannel;
    if (!channel) {
      throw new NotFoundError('call has no known channel to hang up yet');
    }

    await this.ami.action(buildHangupAction({ channel }));
    this.logger.info('call.hangup_requested', { id: record.id, channel });
    return { id: record.id };
  }

  // --- AMI event handling ---------------------------------------------

  _onAmiEvent(evt) {
    switch (evt.event) {
      case 'Newchannel':
        this._handleNewchannel(evt);
        break;
      case 'DialBegin':
        this._handleDial(evt);
        break;
      case 'DialEnd':
        this._handleDial(evt);
        break;
      case 'HangupRequest':
        this._handleHangupRequest(evt);
        break;
      case 'Hangup':
        this._handleHangup(evt);
        break;
      case 'BlindTransfer':
      case 'AttendedTransfer':
        this._handleTransfer(evt);
        break;
      default:
        break;
    }
  }

  _handleNewchannel(evt) {
    const { extensionLength, inboundContexts } = this.config.call;
    const linkedid = evt.linkedid || evt.uniqueid;

    // Does this channel belong to a call we just originated?
    const ext = extractExtension(evt.channel, extensionLength);
    if (ext && this.store.pendingOriginates.has(ext)) {
      const id = this.store.pendingOriginates.get(ext);
      const record = this.store.getById(id);
      if (record && !record.linkedid) {
        record.linkedid = linkedid;
        record.agentChannel = evt.channel;
        this.store.attachLinkedid(id, linkedid);
        this.store.pendingOriginates.delete(ext);
        this.logger.debug('call.correlated_outgoing', { id, channel: evt.channel, linkedid });
      }
      return;
    }

    // Otherwise, is this a fresh inbound call from the trunk side?
    if (inboundContexts.includes(evt.context)) {
      const id = crypto.randomUUID();
      const record = this.store.create({
        id,
        direction: 'incoming',
        caller: '',
        destinationNumber: normalizePhone(evt.calleridnum),
        // Parent record for the whole inbound call; never reported itself.
        // Each operator it rings gets its own attempt record (see
        // _handleIncomingDial) that is what KeyCRM sees.
        state: 'new',
        attempts: new Map(),
        callerHungUp: false,
        linkedid,
        agentChannel: null,
        trunkChannel: evt.channel,
        answeredAt: null,
        createdAt: Date.now(),
      });
      this.store.attachLinkedid(id, linkedid);
      this.logger.debug('call.detected_incoming', { id, channel: evt.channel, linkedid });
    }
  }

  _handleDial(evt) {
    const record = this.store.getByLinkedid(evt.linkedid);
    if (!record) return;

    if (record.direction === 'incoming') {
      this._handleIncomingDial(record, evt);
      return;
    }

    const result = nextState(record, evt);
    if (!result) return;
    Object.assign(record, result.patch);
    this._transition(record, result.newState);
  }

  // An inbound call rings operators one after another (or several at once).
  // Every DialBegin from the trunk channel to an extension is a new attempt
  // reported as 'started'; its DialEnd then resolves it to 'answered' or,
  // if the operator didn't pick up, 'busy'.
  _handleIncomingDial(call, evt) {
    if (evt.channel !== call.trunkChannel) return; // inner legs (Local -> phone)

    if (evt.event === 'DialBegin') {
      const ext = extractDialedExtension(evt, this.config.call.extensionLength);
      if (!ext || call.attempts.has(evt.destchannel)) return;
      const attempt = this.store.create({
        id: crypto.randomUUID(),
        direction: 'incoming',
        caller: ext,
        destinationNumber: call.destinationNumber,
        state: 'started',
        linkedid: null, // the parent owns the linkedid index entry
        agentChannel: null,
        trunkChannel: call.trunkChannel,
        answeredAt: null,
        createdAt: Date.now(),
      });
      call.attempts.set(evt.destchannel, attempt);
      this._report(attempt);
      return;
    }

    const attempt = call.attempts.get(evt.destchannel);
    if (!attempt || attempt.state !== 'started') return;

    if (evt.dialstatus === 'ANSWER') {
      attempt.answeredAt = Date.now();
      this._transition(attempt, 'answered');
    } else if (evt.dialstatus === 'CANCEL' && call.callerHungUp) {
      this._transition(attempt, 'canceled');
      this.store.scheduleCleanup(attempt.id);
    } else if (evt.dialstatus) {
      this._transition(attempt, 'busy');
      this.store.scheduleCleanup(attempt.id);
    }
  }

  _handleHangupRequest(evt) {
    const record = this.store.getByLinkedid(evt.linkedid);
    if (record && record.direction === 'incoming' && evt.channel === record.trunkChannel) {
      record.callerHungUp = true;
    }
  }

  _handleHangup(evt) {
    const record = this.store.getByLinkedid(evt.linkedid);
    if (!record) return;

    if (record.direction === 'incoming') {
      // Many legs share the linkedid; only the trunk hanging up ends the call.
      if (evt.channel !== record.trunkChannel) return;
      for (const attempt of record.attempts.values()) {
        if (attempt.state === 'answered') {
          attempt.duration = attempt.answeredAt ? Math.max(0, Math.round((Date.now() - attempt.answeredAt) / 1000)) : undefined;
          this._transition(attempt, 'completed');
        } else if (attempt.state === 'started') {
          this._transition(attempt, 'canceled');
        }
        this.store.scheduleCleanup(attempt.id);
      }
      this.store.scheduleCleanup(record.id);
      return;
    }

    const result = nextState(record, evt);
    if (result) {
      Object.assign(record, result.patch);
      this._transition(record, result.newState);
    }

    if (record.state === 'completed' || record.state === 'canceled' || record.state === 'busy') {
      this.store.scheduleCleanup(record.id);
    }
  }

  _handleTransfer(evt) {
    const record = this.store.getByLinkedid(evt.linkedid);
    if (!record) return;

    if (record.direction === 'incoming') {
      for (const attempt of record.attempts.values()) {
        if (attempt.state === 'answered') this._transition(attempt, 'transferred');
      }
      return;
    }

    const result = nextState(record, evt);
    if (!result) return;
    Object.assign(record, result.patch);
    this._transition(record, result.newState);
  }

  // --- reporting --------------------------------------------------------

  _transition(record, newState) {
    if (record.state === newState && record.lastReportedState === newState) return;
    record.state = newState;
    this._report(record);
  }

  _report(record) {
    if (record.lastReportedState === record.state) return;
    record.lastReportedState = record.state;

    const payload = {
      id: record.id,
      direction: record.direction,
      destination_number: record.destinationNumber,
      caller: record.caller,
      state: record.state,
    };
    if (record.duration !== undefined && record.duration !== null) {
      payload.duration = record.duration;
    }

    this.webhookClient.postCallEvent(payload).catch((err) => {
      this.logger.error('call.report_failed', { id: record.id, state: record.state, error: err.message });
    });
  }
}

module.exports = { CallManager, NotFoundError, ValidationError };
