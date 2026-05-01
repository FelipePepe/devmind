import type Database from 'better-sqlite3';

export interface WebPushSubscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export class SubscriptionsRepo {
  constructor(private db: Database.Database) {}

  upsert(userId: string, endpoint: string, p256dh: string, auth: string): void {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO webpush_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           user_id = excluded.user_id`
      )
      .run(id, userId, endpoint, p256dh, auth, now);
  }

  findByUser(userId: string): WebPushSubscription[] {
    return this.db
      .prepare('SELECT * FROM webpush_subscriptions WHERE user_id = ?')
      .all(userId) as WebPushSubscription[];
  }

  delete(userId: string, endpoint: string): void {
    this.db
      .prepare('DELETE FROM webpush_subscriptions WHERE endpoint = ? AND user_id = ?')
      .run(endpoint, userId);
  }
}
