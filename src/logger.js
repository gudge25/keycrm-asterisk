const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function createLogger(level) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function log(levelName, msg, meta) {
    if (LEVELS[levelName] > threshold) return;
    const line = { ts: new Date().toISOString(), level: levelName, msg, ...meta };
    const out = levelName === 'error' ? process.stderr : process.stdout;
    out.write(JSON.stringify(line) + '\n');
  }

  return {
    error: (msg, meta) => log('error', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    debug: (msg, meta) => log('debug', msg, meta),
  };
}

module.exports = { createLogger };
