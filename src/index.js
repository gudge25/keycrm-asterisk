const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { AmiConnection } = require('./ami/connection');
const { CallStore } = require('./callState/callStore');
const { CallManager } = require('./callState/callManager');
const { WebhookClient } = require('./keycrm/webhookClient');
const { createServer } = require('./http/server');
const { makeCallStartRoute } = require('./http/routes/callStart');
const { makeCallEndRoute } = require('./http/routes/callEnd');

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }

  const logger = createLogger(config.logLevel);

  const ami = new AmiConnection({ ...config.ami, logger });
  const store = new CallStore();
  const webhookClient = new WebhookClient({ url: config.keycrm.webhookUrl, ...config.webhook, logger });
  const callManager = new CallManager({ ami, store, webhookClient, logger, config });

  store.startStaleSweep({
    maxAgeMs: config.call.staleCallMaxAgeMs,
    intervalMs: config.call.staleSweepIntervalMs,
    logger,
  });

  const server = createServer({
    sharedSecret: config.http.sharedSecret,
    logger,
    routes: {
      '/call/start': makeCallStartRoute({ callManager }),
      '/call/end': makeCallEndRoute({ callManager }),
    },
  });

  server.listen(config.http.port, () => {
    logger.info('http.listening', { port: config.http.port });
  });

  const shutdown = (signal) => {
    logger.info('shutdown', { signal });
    server.close();
    ami.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
