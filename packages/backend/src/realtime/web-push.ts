import webpush from 'web-push';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { SubscriptionsRepo } from '../db/repos/subscriptions.js';

export class PushService {
  constructor(private subscriptions: SubscriptionsRepo) {
    webpush.setVapidDetails(
      config.VAPID_SUBJECT,
      config.VAPID_PUBLIC_KEY,
      config.VAPID_PRIVATE_KEY
    );
  }

  subscribe(userId: string, endpoint: string, p256dh: string, auth: string): void {
    this.subscriptions.upsert(userId, endpoint, p256dh, auth);
  }

  async sendPush(userId: string, payload: unknown): Promise<void> {
    const subs = this.subscriptions.findByUser(userId);
    const body = JSON.stringify(payload);
    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body
          );
        } catch (err) {
          logger.warn({ err, userId, endpoint: sub.endpoint }, 'Push notification failed');
        }
      })
    );
  }
}
