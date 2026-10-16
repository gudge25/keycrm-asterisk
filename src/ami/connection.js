const Manager = require('asterisk-manager');

class AmiConnection {
  constructor({ host, port, username, secret, logger }) {
    this.logger = logger;
    this.ami = new Manager(port, host, username, secret, true);
    this.ami.keepConnected();

    this.ami.on('connect', () => this.logger.info('ami.tcp_connected'));
    this.ami.on('close', () => this.logger.warn('ami.disconnected'));
    this.ami.on('error', (err) => this.logger.error('ami.error', { error: err.message }));
    this.ami.on('response', (evt) => {
      if (evt.response === 'Success' && evt.message === 'Authentication accepted') {
        this.logger.info('ami.authenticated');
      }
    });
  }

  // handler receives every raw AMI event (Newchannel, DialBegin, DialEnd, Hangup, ...).
  onEvent(handler) {
    this.ami.on('managerevent', (evt) => {
      this.logger.debug('ami.event', {
        event: evt.event,
        channel: evt.channel,
        uniqueid: evt.uniqueid,
        linkedid: evt.linkedid,
      });
      handler(evt);
    });
  }

  action(fields) {
    return new Promise((resolve, reject) => {
      this.ami.action(fields, (err, res) => {
        if (err) {
          reject(new Error((res && res.message) || 'AMI action failed'));
          return;
        }
        resolve(res);
      });
    });
  }

  close() {
    this.ami.disconnect();
  }
}

module.exports = { AmiConnection };
