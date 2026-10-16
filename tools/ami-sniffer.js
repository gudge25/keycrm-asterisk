// Standalone: connects to AMI independently of the main service and
// dumps every raw event to stdout. Useful for watching what Asterisk
// actually sends while testing the bridge.
require('dotenv').config();
const Manager = require('asterisk-manager');

const host = process.env.AMI_HOST || '127.0.0.1';
const port = Number(process.env.AMI_PORT || 5038);
const username = process.env.AMI_USERNAME;
const secret = process.env.AMI_SECRET;

if (!username || !secret) {
  process.stderr.write('AMI_USERNAME and AMI_SECRET must be set (via .env or env vars)\n');
  process.exit(1);
}

const ami = new Manager(port, host, username, secret, true);
ami.keepConnected();

ami.on('connect', () => console.log('[sniffer] connected'));
ami.on('close', () => console.log('[sniffer] disconnected'));
ami.on('managerevent', (evt) => {
  console.log(JSON.stringify(evt, null, 2));
});
