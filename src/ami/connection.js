const Manager = require('asterisk-manager');

class AmiConnection {
  constructor({ host, port, username, secret, logger, eventMask = 'call' }) {
    this.logger = logger;
    this.ami = new Manager(port, host, username, secret, true);
    this.ami.keepConnected();

    this.ami.on('connect', () => this.logger.info('ami.tcp_connected'));
    this.ami.on('close', () => this.logger.warn('ami.disconnected'));
    this.ami.on('error', (err) => this.logger.error('ami.error', { error: err.message }));
    this.ami.on('response', (evt) => {
      if (evt.response === 'Success' && evt.message === 'Authentication accepted') {
        this.logger.info('ami.authenticated');
        // Login subscribes to every event class ("Events: on"); narrow it down
        // to just the "call" class (Newchannel/DialBegin/DialEnd/Hangup/
        // transfers — everything callManager uses) so we're not also flooded
        // with per-dialplan-step VarSet/Newexten and other unrelated noise.
        // "dialplan" is added only when recording links are enabled, for
        // the MIXMONITOR_FILENAME VarSet.
        // Must be re-sent after every (re)login, since login always resets
        // the mask back to "on".
        this.ami.action({ action: 'events', eventmask: eventMask }, (err, res) => {
          if (err) {
            this.logger.warn('ami.eventmask_failed', { error: res && res.message });
          } else {
            this.logger.debug('ami.eventmask_set', { eventmask: eventMask });
          }
        });
      }
    });
  }

  // handler receives every raw AMI event (Newchannel, DialBegin, DialEnd, Hangup, ...).
  onEvent(handler) {
    this.ami.on('managerevent', (evt) => {
      // VarSet fires for every dialplan variable; far too noisy to log.
      if (evt.event !== 'VarSet') this.logger.debug('ami.event', {
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
