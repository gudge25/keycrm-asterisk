# keycrm-telephony

Bridges an Asterisk 20 (FreePBX) PBX to KeyCRM's "Other" telephony channel. KeyCRM's integration is a plain HTTP/webhook protocol, not AMI-aware — this service keeps a persistent AMI connection to Asterisk, translates call events into KeyCRM's expected JSON, and exposes the two HTTP endpoints KeyCRM calls to originate/hang up calls.

Scope: **report-only** for incoming calls. Asterisk's existing dialplan decides who rings; this service only observes and reports state. KeyCRM's `action:"route"` lookup (active call redirection) is not implemented.

## Event volume

On login, AMI defaults to streaming every event class (dialplan, verbose, security, CDR, etc.). We immediately narrow that to just the `call` class — the one covering `Newchannel`/`DialBegin`/`DialEnd`/`Hangup`/transfers, i.e. everything `callManager` actually uses — via an `Action: Events, EventMask: call` sent right after each login (including after reconnects, since login always resets the mask back to "on"). Without this, a single call on a busy FreePBX box can generate dozens of `VarSet`/`Newexten` events we'd otherwise receive and immediately discard.

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

- **Call initiation URL**: `http://<this-host>:<HTTP_PORT>/call/start?token=<HTTP_SHARED_SECRET>`
- **Call end URL**: `http://<this-host>:<HTTP_PORT>/call/end?token=<HTTP_SHARED_SECRET>`
- **Webhook URL**: copy the one KeyCRM generates into `KEYCRM_WEBHOOK_URL` below.
- Deep link: off.

Both HTTP endpoints require the shared secret either via the `X-Keycrm-Shared-Secret` header or a `?token=` query param (KeyCRM's "Other" channel UI has no field for custom headers, so the query param is what you'll actually use when configuring the URLs above — the header is only useful for other callers, e.g. manual curl testing).

## Configuration

Copy `.env.example` to `.env` and fill in real values. See that file for every variable; the important ones:

- `HTTP_PORT`: **check this isn't already taken before picking it.** FreePBX/Asterisk's own built-in HTTP server (`http.conf`) commonly binds port `8088` by default, so that's a common collision — run `ss -tlnp | grep <port>` first. `8080` is a reasonable alternative if `8088` is taken.
- `ORIGINATE_CHANNEL_TEMPLATE` (`PJSIP/{ext}`) and `ORIGINATE_CONTEXT` (`from-internal`) control how click-to-call originates — adjust if your dialplan differs.
- `INBOUND_CONTEXTS` lists the context(s) a fresh external `Newchannel` arrives in. `dialplan show from-trunk` showing an essentially empty context that just `Include =>`s `from-pstn` is normal for FreePBX — the channel's *initial* `Context` on `Newchannel` still reflects the trunk's configured context (often `from-trunk` itself), not where the dialplan logic actually lives. Don't guess from `dialplan show` alone: run `node tools/ami-sniffer.js`, place one real test call to a DID, and read the `context` field off the first `Newchannel` event — that's the value to put here.
- `EXTENSION_LENGTH=4` is used to recognize internal extensions inside Asterisk channel/dialstring values.

## Running

```
npm install
cp .env.example .env   # then edit
npm start
```

## Deploying as a systemd service

The shipped unit file (`systemd/keycrm-telephony.service`) assumes the repo is cloned to `/opt/keycrm-asterisk`. If you cloned it somewhere else, edit the `WorkingDirectory`/`EnvironmentFile`/`ExecStart` paths in that file first (or `sed -i 's#/opt/keycrm-asterisk#<your path>#g' systemd/keycrm-telephony.service`).

Recommended order — confirm it runs correctly in the foreground *before* installing it as a service, so you're not debugging through `journalctl`:

```
cd /opt/keycrm-asterisk
git clone <this repo> .          # or however you got the code here
npm ci --omit=dev
cp .env.example .env             # then edit with real values
LOG_LEVEL=debug node src/index.js
```

Look for `ami.tcp_connected` and `ami.authenticated` in the output. Once that's confirmed (Ctrl+C to stop it), install as a service:

```
chmod 600 .env
useradd --system --no-create-home keycrm-telephony
chown -R keycrm-telephony:keycrm-telephony /opt/keycrm-asterisk
cp systemd/keycrm-telephony.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now keycrm-telephony
journalctl -u keycrm-telephony -f
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
curl -X POST "http://127.0.0.1:${HTTP_PORT}/call/start?token=${HTTP_SHARED_SECRET}" \
  -H 'Content-Type: application/json' \
  -d '{"caller":"<real 4-digit ext>","destination_number":"<reachable test number>"}'

# hang up (use the id returned above)
curl -X POST "http://127.0.0.1:${HTTP_PORT}/call/end?token=${HTTP_SHARED_SECRET}" \
  -H 'Content-Type: application/json' \
  -d '{"id":"<id>"}'
```

For incoming calls, place a real test call through an available trunk/softphone to a test DID and watch `fake-keycrm-server`'s output for `started` → `pending` → `answered` → `completed`.

## Known MVP limitations

- Incoming calls: `caller` is empty on the initial `started` POST and only gets populated once Asterisk's dialplan starts dialing an internal extension (`DialBegin`). For ring groups, the reported `caller` during `pending` is just the first candidate extension seen and is corrected to the actual answering extension at `answered`.
- `busy` vs `canceled`: only a real `DialStatus=BUSY` produces `busy`; every other "nobody connected" outcome (no answer, rejected, congestion, cancel) is reported as `canceled`. KeyCRM's docs don't define this mapping precisely — revisit if real call patterns disagree.
- `audio_url` (call recording) is not implemented.
- The webhook client retries with backoff but has no persistent queue — if KeyCRM's webhook URL is unreachable for longer than `WEBHOOK_MAX_RETRIES` allows, that state update is dropped (logged at `error` level) rather than durably queued.
- `/call/end` without a `BridgeEnter`-aware fallback: it hangs up whatever channel is currently tracked for the call (preferring the agent leg), which should tear down the bridge, but hasn't been exercised against every possible mid-call state.
