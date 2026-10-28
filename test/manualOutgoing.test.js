const test = require('node:test');
const assert = require('node:assert');
const { CallManager } = require('../src/callState/callManager');
const { CallStore } = require('../src/callState/callStore');

function setup() {
  const sent = [];
  let emit;
  const ami = { onEvent: (fn) => (emit = fn), action: async () => ({ response: 'Success' }) };
  const logger = { info() {}, warn() {}, debug() {}, error() {} };
  const cm = new CallManager({
    ami,
    store: new CallStore(),
    logger,
    webhookClient: { postCallEvent: async (p) => sent.push(p) },
    config: {
      call: {
        extensionLength: 4, inboundContexts: ['from-trunk'], manualOutgoing: true,
        originateChannelTemplate: 'PJSIP/{ext}', originateContext: 'from-internal',
        originateTimeoutMs: 30000, maxConcurrentCalls: 50,
      },
      routing: {},
      recording: { baseUrl: 'https://rec.example', monitorDir: '/var/spool/rec' },
    },
  });
  return { cm, sent, emit: (e) => emit(e) };
}

const dial = (o) => ({ event: 'DialBegin', channel: 'PJSIP/1043-0001', destchannel: 'PJSIP/trunk-0002', linkedid: 'L1', ...o });

test('manual call is reported through to completed', () => {
  const t = setup();
  t.emit(dial({ exten: '0509491827' }));
  t.emit(dial({ exten: '0509491827' })); // duplicate event
  t.emit({ event: 'DialEnd', channel: 'PJSIP/1043-0001', dialstatus: 'ANSWER', linkedid: 'L1' });
  t.emit({ event: 'Hangup', channel: 'PJSIP/1043-0001', linkedid: 'L1' });
  assert.deepStrictEqual(t.sent.map((p) => p.state), ['started', 'pending', 'answered', 'completed']);
  assert.strictEqual(t.sent[0].direction, 'outgoing');
  assert.strictEqual(t.sent[0].caller, '1043');
  assert.strictEqual(t.sent[0].destination_number, '0509491827');
});

test("exten 's' falls back to the dialstring", () => {
  const t = setup();
  t.emit(dial({ exten: 's', dialstring: '0509491827@0970408408' }));
  assert.strictEqual(t.sent[0].destination_number, '0509491827');
});

test('chan_sip dialstring does not leak the trunk name into the number', () => {
  const t = setup();
  t.emit(dial({ exten: 's', dialstring: 'trunk1/0509491827' }));
  assert.strictEqual(t.sent[0].destination_number, '0509491827');
});

test('internal calls and short codes are ignored', () => {
  const t = setup();
  t.emit(dial({ destchannel: 'PJSIP/1032-0002', exten: '1032' }));
  t.emit(dial({ exten: '*43', linkedid: 'L2' }));
  assert.strictEqual(t.sent.length, 0);
});

test('click-to-call is reported once', async () => {
  const t = setup();
  await t.cm.startOutgoingCall({ caller: '1043', destinationNumber: '0509491827' });
  t.emit({ event: 'Newchannel', channel: 'PJSIP/1043-0001', linkedid: 'L1', uniqueid: 'L1', context: 'from-internal' });
  t.emit(dial({ exten: '0509491827' }));
  assert.strictEqual(t.cm.store.byId.size, 1);
});

test('a pending click-to-call is not mistaken for a manual call', async () => {
  const t = setup();
  await t.cm.startOutgoingCall({ caller: '1043', destinationNumber: '0509491827' });
  const before = t.sent.length;
  t.emit(dial({ exten: '0509491827', linkedid: 'uncorrelated' }));
  assert.strictEqual(t.sent.length, before);
  assert.strictEqual(t.cm.store.byId.size, 1);
});

test('inbound call forwarded out by an operator stays incoming', () => {
  const t = setup();
  t.emit({ event: 'Newchannel', channel: 'PJSIP/trunk-0009', linkedid: 'L5', uniqueid: 'L5', context: 'from-trunk', calleridnum: '380501112233' });
  t.emit({ event: 'DialBegin', channel: 'PJSIP/trunk-0009', destchannel: 'PJSIP/1043-0010', linkedid: 'L5' });
  t.emit({ event: 'DialBegin', channel: 'PJSIP/1043-0010', destchannel: 'PJSIP/trunk-0011', exten: '0509491827', linkedid: 'L5' });
  assert.ok(t.sent.every((p) => p.direction === 'incoming'));
});

test('recording that starts before the first DialBegin is kept', () => {
  const t = setup();
  t.emit({ event: 'VarSet', channel: 'PJSIP/1043-0001', linkedid: 'L1', variable: 'MIXMONITOR_FILENAME', value: '/var/spool/rec/2026/out-0509491827-1043-x.wav' });
  t.emit(dial({ exten: '0509491827' }));
  t.emit({ event: 'DialEnd', channel: 'PJSIP/1043-0001', dialstatus: 'ANSWER', linkedid: 'L1' });
  t.emit({ event: 'Hangup', channel: 'PJSIP/1043-0001', linkedid: 'L1' });
  const completed = t.sent.find((p) => p.state === 'completed');
  assert.strictEqual(completed.audio_url, 'https://rec.example/2026/out-0509491827-1043-x.wav');
});

test('real FreePBX events: trunk leg in from-pstn does not hide a manual outgoing call', () => {
  const t = setup();
  t.cm.config.call.inboundContexts = ['from-pstn', 'from-trunk'];
  const L = '1793190763.10259';
  t.emit({ event: 'Newchannel', channel: 'PJSIP/1043-00000ecd', context: 'from-internal', exten: '0669197533', uniqueid: L, linkedid: L, calleridnum: '1043' });
  t.emit({ event: 'Newchannel', channel: 'PJSIP/0970408408-00000ece', context: 'from-pstn', exten: 's', uniqueid: '1793190763.10260', linkedid: L, calleridnum: '<unknown>' });
  t.emit({
    event: 'DialBegin', channel: 'PJSIP/1043-00000ecd', context: 'trunk-dial-with-exten', exten: '0669197533',
    destchannel: 'PJSIP/0970408408-00000ece', destcalleridnum: '0669197533', dialstring: '0669197533@0970408408',
    uniqueid: L, linkedid: L,
  });
  assert.deepStrictEqual(t.sent.map((p) => [p.direction, p.caller, p.destination_number, p.state]), [
    ['outgoing', '1043', '0669197533', 'started'],
    ['outgoing', '1043', '0669197533', 'pending'],
  ]);
});

test('a trunk channel that is the first of its call is still an incoming call', () => {
  const t = setup();
  t.emit({ event: 'Newchannel', channel: 'PJSIP/trunk-0009', context: 'from-trunk', uniqueid: 'L9', linkedid: 'L9', calleridnum: '380501112233' });
  t.emit({ event: 'DialBegin', channel: 'PJSIP/trunk-0009', destchannel: 'PJSIP/1043-0010', linkedid: 'L9' });
  assert.deepStrictEqual(t.sent.map((p) => [p.direction, p.caller, p.state]), [['incoming', '1043', 'started']]);
});
