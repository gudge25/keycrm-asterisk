require('dotenv').config();

const REQUIRED_STRINGS = [
  'AMI_HOST',
  'AMI_USERNAME',
  'AMI_SECRET',
  'HTTP_SHARED_SECRET',
  'KEYCRM_WEBHOOK_URL',
  'ORIGINATE_CHANNEL_TEMPLATE',
  'ORIGINATE_CONTEXT',
];

function requireInt(name, { min } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return { error: `${name} is required` };
  const value = Number(raw);
  if (!Number.isInteger(value) || (min !== undefined && value < min)) {
    return { error: `${name} must be an integer${min !== undefined ? ` >= ${min}` : ''}` };
  }
  return { value };
}

function optionalInt(name, defaultValue, { min } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return { value: defaultValue };
  const value = Number(raw);
  if (!Number.isInteger(value) || (min !== undefined && value < min)) {
    return { error: `${name} must be an integer${min !== undefined ? ` >= ${min}` : ''}` };
  }
  return { value };
}

function loadConfig() {
  const errors = [];

  for (const name of REQUIRED_STRINGS) {
    if (!process.env[name]) errors.push(`${name} is required`);
  }

  if (process.env.ORIGINATE_CHANNEL_TEMPLATE && !process.env.ORIGINATE_CHANNEL_TEMPLATE.includes('{ext}')) {
    errors.push('ORIGINATE_CHANNEL_TEMPLATE must contain the literal placeholder {ext}');
  }

  const amiPort = requireInt('AMI_PORT', { min: 1 });
  const httpPort = requireInt('HTTP_PORT', { min: 1 });
  const extensionLength = requireInt('EXTENSION_LENGTH', { min: 1 });
  const originateTimeoutMs = requireInt('ORIGINATE_TIMEOUT_MS', { min: 1000 });
  const webhookTimeoutMs = requireInt('WEBHOOK_TIMEOUT_MS', { min: 100 });
  const webhookMaxRetries = requireInt('WEBHOOK_MAX_RETRIES', { min: 0 });
  const webhookRetryBaseMs = requireInt('WEBHOOK_RETRY_BASE_MS', { min: 10 });
  const maxConcurrentCalls = optionalInt('MAX_CONCURRENT_CALLS', 50, { min: 1 });
  const staleCallMaxAgeMs = optionalInt('STALE_CALL_MAX_AGE_MS', 4 * 60 * 60 * 1000, { min: 60000 });
  const staleSweepIntervalMs = optionalInt('STALE_SWEEP_INTERVAL_MS', 5 * 60 * 1000, { min: 10000 });

  for (const [name, result] of [
    ['AMI_PORT', amiPort],
    ['HTTP_PORT', httpPort],
    ['EXTENSION_LENGTH', extensionLength],
    ['ORIGINATE_TIMEOUT_MS', originateTimeoutMs],
    ['WEBHOOK_TIMEOUT_MS', webhookTimeoutMs],
    ['WEBHOOK_MAX_RETRIES', webhookMaxRetries],
    ['WEBHOOK_RETRY_BASE_MS', webhookRetryBaseMs],
    ['MAX_CONCURRENT_CALLS', maxConcurrentCalls],
    ['STALE_CALL_MAX_AGE_MS', staleCallMaxAgeMs],
    ['STALE_SWEEP_INTERVAL_MS', staleSweepIntervalMs],
  ]) {
    if (result.error) errors.push(result.error);
  }

  let keycrmWebhookUrl;
  if (process.env.KEYCRM_WEBHOOK_URL) {
    try {
      keycrmWebhookUrl = new URL(process.env.KEYCRM_WEBHOOK_URL).toString();
    } catch {
      errors.push('KEYCRM_WEBHOOK_URL must be a valid URL');
    }
  }

  // Public URL prefix that maps onto RECORDING_DIR (e.g. an nginx location).
  // Optional: when unset, recordings are neither tracked nor sent to KeyCRM.
  let recordingBaseUrl;
  if (process.env.RECORDING_BASE_URL) {
    try {
      recordingBaseUrl = new URL(process.env.RECORDING_BASE_URL).toString().replace(/\/+$/, '');
    } catch {
      errors.push('RECORDING_BASE_URL must be a valid URL');
    }
  }

  const inboundContexts = (process.env.INBOUND_CONTEXTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (inboundContexts.length === 0) {
    errors.push('INBOUND_CONTEXTS must list at least one context');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    ami: {
      host: process.env.AMI_HOST,
      port: amiPort.value,
      username: process.env.AMI_USERNAME,
      secret: process.env.AMI_SECRET,
    },
    http: {
      port: httpPort.value,
      sharedSecret: process.env.HTTP_SHARED_SECRET,
    },
    keycrm: {
      webhookUrl: keycrmWebhookUrl,
    },
    call: {
      extensionLength: extensionLength.value,
      originateChannelTemplate: process.env.ORIGINATE_CHANNEL_TEMPLATE,
      originateContext: process.env.ORIGINATE_CONTEXT,
      originateTimeoutMs: originateTimeoutMs.value,
      inboundContexts,
      maxConcurrentCalls: maxConcurrentCalls.value,
      staleCallMaxAgeMs: staleCallMaxAgeMs.value,
      staleSweepIntervalMs: staleSweepIntervalMs.value,
    },
    recording: {
      baseUrl: recordingBaseUrl,
      monitorDir: (process.env.RECORDING_DIR || '/var/spool/asterisk/monitor').replace(/\/+$/, ''),
    },
    webhook: {
      timeoutMs: webhookTimeoutMs.value,
      maxRetries: webhookMaxRetries.value,
      retryBaseMs: webhookRetryBaseMs.value,
    },
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

module.exports = { loadConfig };
