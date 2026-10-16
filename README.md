# keycrm-telephony

Bridges an Asterisk 20 (FreePBX) PBX to KeyCRM's "Other" telephony channel. KeyCRM's integration is a plain HTTP/webhook protocol, not AMI-aware — this service keeps a persistent AMI connection to Asterisk, translates call events into KeyCRM's expected JSON, and exposes the two HTTP endpoints KeyCRM calls to originate/hang up calls.

Scope: **report-only** for incoming calls. Asterisk's existing dialplan decides who rings; this service only observes and reports state. KeyCRM's `action:"route"` lookup (active call redirection) is not implemented.

## Asterisk setup

Add an AMI user in `manager.conf` (e.g. via FreePBX's custom config):

```ini
[keycrm]
secret = <matches AMI_SECRET below>
read = system,call,log,dialplan,originate,agent
write = system,call,originate,agent
permit=127.0.0.1/255.255.255.255
```

## KeyCRM channel setup

In KeyCRM: Settings → Communications → Telephony → add a channel, service type "Other".

- **Call initiation URL**: `http://<this-host>:<HTTP_PORT>/call/start`
- **Call end URL**: `http://<this-host>:<HTTP_PORT>/call/end`
- **Webhook URL**: copy the one KeyCRM generates into `KEYCRM_WEBHOOK_URL` below.
- Deep link: off.

Both HTTP endpoints require a `X-Keycrm-Shared-Secret` header matching `HTTP_SHARED_SECRET` — KeyCRM's "Other" channel type doesn't document an auth scheme for the URLs it calls, so this is our own minimal guard. If KeyCRM's UI can't send custom headers, put this service behind a reverse proxy that injects it, or drop the check.

## Configuration

Copy `.env.example` to `.env` and fill in real values. See that file for every variable; the important ones:

- `ORIGINATE_CHANNEL_TEMPLATE` (`PJSIP/{ext}`) and `ORIGINATE_CONTEXT` (`from-internal`) control how click-to-call originates — adjust if your dialplan differs.
- `INBOUND_CONTEXTS` lists the context(s) a fresh external `Newchannel` arrives in (FreePBX default: `from-trunk`, routed through `ext-did`). Adjust to match `dialplan show` on your box if calls aren't detected.
- `EXTENSION_LENGTH=4` is used to recognize internal extensions inside Asterisk channel/dialstring values.

## Running

```
npm install
cp .env.example .env   # then edit
npm start
```

## Deploying as a systemd service

```
sudo useradd --system --no-create-home keycrm-telephony
sudo mkdir -p /opt/keycrm-telephony
# copy repo contents to /opt/keycrm-telephony, then:
cd /opt/keycrm-telephony
npm ci --omit=dev
chmod 600 .env
sudo chown -R keycrm-telephony:keycrm-telephony /opt/keycrm-telephony
sudo cp systemd/keycrm-telephony.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now keycrm-telephony
```

`Restart=always` is an OS-level safety net on top of (not a replacement for) the AMI client's own reconnect-with-backoff (handled by `asterisk-manager`'s `keepConnected()`, 10s → 60s linear backoff).

## Testing without a live KeyCRM account

```
node tools/fake-keycrm-server.js 9099        # stand-in for KEYCRM_WEBHOOK_URL
node tools/ami-sniffer.js                    # independent raw AMI event dump
LOG_LEVEL=debug npm start
```

Point `.env`'s `KEYCRM_WEBHOOK_URL` at `http://127.0.0.1:9099`, then:

```
# click-to-call
curl -X POST http://127.0.0.1:8088/call/start \
  -H 'X-Keycrm-Shared-Secret: <HTTP_SHARED_SECRET>' -H 'Content-Type: application/json' \
  -d '{"caller":"<real 4-digit ext>","destination_number":"<reachable test number>"}'

# hang up (use the id returned above)
curl -X POST http://127.0.0.1:8088/call/end \
  -H 'X-Keycrm-Shared-Secret: <HTTP_SHARED_SECRET>' -H 'Content-Type: application/json' \
  -d '{"id":"<id>"}'
```

For incoming calls, place a real test call through an available trunk/softphone to a test DID and watch `fake-keycrm-server`'s output for `started` → `pending` → `answered` → `completed`.

## Known MVP limitations

- Incoming calls: `caller` is empty on the initial `started` POST and only gets populated once Asterisk's dialplan starts dialing an internal extension (`DialBegin`). For ring groups, the reported `caller` during `pending` is just the first candidate extension seen and is corrected to the actual answering extension at `answered`.
- `busy` vs `canceled`: only a real `DialStatus=BUSY` produces `busy`; every other "nobody connected" outcome (no answer, rejected, congestion, cancel) is reported as `canceled`. KeyCRM's docs don't define this mapping precisely — revisit if real call patterns disagree.
- `audio_url` (call recording) is not implemented.
- The webhook client retries with backoff but has no persistent queue — if KeyCRM's webhook URL is unreachable for longer than `WEBHOOK_MAX_RETRIES` allows, that state update is dropped (logged at `error` level) rather than durably queued.
- `/call/end` without a `BridgeEnter`-aware fallback: it hangs up whatever channel is currently tracked for the call (preferring the agent leg), which should tear down the bridge, but hasn't been exercised against every possible mid-call state.
