// Telegram setWebhook on boot. Spec 10 §Webhook setup.

export interface RegisterWebhookConfig {
  botToken: string;
  /** Public URL where Watchfire receives `POST /webhook/telegram`. */
  webhookUrl: string;
  /** Secret echoed back in X-Telegram-Bot-Api-Secret-Token. */
  secretToken: string;
  /** Injection point for testing; default uses globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface RegisterWebhookResult {
  ok: boolean;
  status: number;
  body: string;
}

export async function registerWebhook(
  config: RegisterWebhookConfig,
): Promise<RegisterWebhookResult> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const url = `https://api.telegram.org/bot${config.botToken}/setWebhook`;
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: config.webhookUrl,
      secret_token: config.secretToken,
      allowed_updates: ['message'],
      drop_pending_updates: false,
      max_connections: 4,
    }),
  });
  const body = await resp.text();
  return { ok: resp.ok, status: resp.status, body };
}
