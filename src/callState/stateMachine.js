// Pure: given a tracked CallRecord and an already-correlated AMI event,
// decide the next KeyCRM state. Returns null when the event doesn't
// warrant a transition (including duplicate/late events on a call that
// has already reached a terminal state).

const DIAL_STATUS_TO_STATE = {
  ANSWER: 'answered',
  BUSY: 'busy',
  NOANSWER: 'canceled',
  CANCEL: 'canceled',
  CONGESTION: 'canceled',
  CHANUNAVAIL: 'canceled',
  DONTCALL: 'canceled',
};

function nextState(record, amiEvent) {
  switch (amiEvent.event) {
    case 'DialBegin':
      // Incoming calls get 'started' from the first DialBegin (callManager)
      // and fan out to several legs; don't flip to 'pending' on each.
      if (record.direction === 'incoming') return null;
      if (record.state === 'started' || record.state === 'pending') {
        return { newState: 'pending', patch: {} };
      }
      return null;

    case 'DialEnd': {
      const mapped = DIAL_STATUS_TO_STATE[amiEvent.dialstatus];
      if (!mapped) return null;
      if (record.state === 'answered') return null;
      if (mapped === 'answered') {
        return { newState: 'answered', patch: { answeredAt: Date.now() } };
      }
      return { newState: mapped, patch: {} };
    }

    case 'Hangup':
      if (record.state === 'answered') {
        const duration = record.answeredAt
          ? Math.max(0, Math.round((Date.now() - record.answeredAt) / 1000))
          : undefined;
        return { newState: 'completed', patch: { duration } };
      }
      if (record.state === 'started' || record.state === 'pending') {
        return { newState: 'canceled', patch: {} };
      }
      return null;

    case 'BlindTransfer':
    case 'AttendedTransfer':
      if (record.state === 'answered') {
        return { newState: 'transferred', patch: {} };
      }
      return null;

    default:
      return null;
  }
}

module.exports = { nextState };
