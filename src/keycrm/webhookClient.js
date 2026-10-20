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

  // KeyCRM's "route" action: which manager (extension) owns this client?
  // Single attempt, no retries — the caller is on the line. Returns the
  // manager's extension number, or null if unknown / on any failure.
  async lookupManager(number, timeoutMs) {
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'route', route: number }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        this.logger.debug('keycrm.route.no_match', { status: res.status });
        return null;
      }
      const data = await res.json();
      const manager = data && data.client && data.client.manager && data.client.manager.number;
      return manager ? String(manager) : null;
    } catch (err) {
      this.logger.warn('keycrm.route.failed', { error: err.message });
      return null;
    }
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
        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).slice(0, 500);
          const err = new Error(`HTTP ${res.status}`);
          err.detail = detail;
          throw err;
        }
        this.logger.debug('keycrm.webhook.sent', { id: callPayload.id, state: callPayload.state, attempt });
        return;
      } catch (err) {
        this.logger.warn('keycrm.webhook.attempt_failed', {
          id: callPayload.id,
          state: callPayload.state,
          attempt,
          error: err.message,
          ...(err.detail && { response: err.detail }),
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
