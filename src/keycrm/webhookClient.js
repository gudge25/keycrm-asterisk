function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class WebhookClient {
  constructor({ url, timeoutMs, maxRetries, retryBaseMs, logger }) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.retryBaseMs = retryBaseMs;
    this.logger = logger;
  }

  async postCallEvent(callPayload) {
    const body = JSON.stringify({ action: 'call', call: callPayload });
    let attempt = 0;

    while (true) {
      attempt += 1;
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.logger.debug('keycrm.webhook.sent', { id: callPayload.id, state: callPayload.state, attempt });
        return;
      } catch (err) {
        this.logger.warn('keycrm.webhook.attempt_failed', {
          id: callPayload.id,
          state: callPayload.state,
          attempt,
          error: err.message,
        });
        if (attempt > this.maxRetries) {
          this.logger.error('keycrm.webhook.dropped', { id: callPayload.id, state: callPayload.state, payload: callPayload });
          return;
        }
        await sleep(this.retryBaseMs * 2 ** (attempt - 1));
      }
    }
  }
}

module.exports = { WebhookClient };
