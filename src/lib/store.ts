import "server-only";
import { Redis } from "@upstash/redis";
import type { PushSubscription as WebPushSubscription } from "web-push";

export type Repeat = "none" | "daily";

export type Reminder = {
  id: string;
  deviceId: string;
  title: string;
  body: string;
  /** Next fire time, epoch ms. */
  at: number;
  repeat: Repeat;
};

export interface Store {
  saveSubscription(deviceId: string, sub: WebPushSubscription): Promise<void>;
  getSubscription(deviceId: string): Promise<WebPushSubscription | null>;
  /** Removes the subscription and every reminder belonging to the device. */
  deleteDevice(deviceId: string): Promise<void>;
  saveReminder(reminder: Reminder): Promise<void>;
  listReminders(deviceId: string): Promise<Reminder[]>;
  deleteReminder(deviceId: string, id: string): Promise<void>;
  dueReminders(now: number): Promise<Reminder[]>;
}

// Redis layout:
//   sub:{deviceId}         -> push subscription JSON
//   reminder:{id}          -> reminder JSON
//   device:{deviceId}:rems -> set of reminder ids
//   due                    -> sorted set of reminder ids, scored by `at`
class RedisStore implements Store {
  constructor(private redis: Redis) {}

  async saveSubscription(deviceId: string, sub: WebPushSubscription) {
    await this.redis.set(`sub:${deviceId}`, sub);
  }

  async getSubscription(deviceId: string) {
    return this.redis.get<WebPushSubscription>(`sub:${deviceId}`);
  }

  async deleteDevice(deviceId: string) {
    const ids = await this.redis.smembers(`device:${deviceId}:rems`);
    const tx = this.redis.multi();
    tx.del(`sub:${deviceId}`, `device:${deviceId}:rems`);
    for (const id of ids) {
      tx.del(`reminder:${id}`);
      tx.zrem("due", id);
    }
    await tx.exec();
  }

  async saveReminder(reminder: Reminder) {
    const tx = this.redis.multi();
    tx.set(`reminder:${reminder.id}`, reminder);
    tx.sadd(`device:${reminder.deviceId}:rems`, reminder.id);
    tx.zadd("due", { score: reminder.at, member: reminder.id });
    await tx.exec();
  }

  async listReminders(deviceId: string) {
    const ids = await this.redis.smembers(`device:${deviceId}:rems`);
    if (ids.length === 0) return [];
    const rows = await this.redis.mget<(Reminder | null)[]>(
      ...ids.map((id) => `reminder:${id}`),
    );
    return rows.filter((r): r is Reminder => r !== null).sort((a, b) => a.at - b.at);
  }

  async deleteReminder(deviceId: string, id: string) {
    const tx = this.redis.multi();
    tx.del(`reminder:${id}`);
    tx.srem(`device:${deviceId}:rems`, id);
    tx.zrem("due", id);
    await tx.exec();
  }

  async dueReminders(now: number) {
    const ids = await this.redis.zrange<string[]>("due", 0, now, { byScore: true });
    if (ids.length === 0) return [];
    const rows = await this.redis.mget<(Reminder | null)[]>(
      ...ids.map((id) => `reminder:${id}`),
    );
    return rows.filter((r): r is Reminder => r !== null);
  }
}

// Local development fallback. Data lives in process memory and is lost on restart.
class MemoryStore implements Store {
  private subs = new Map<string, WebPushSubscription>();
  private reminders = new Map<string, Reminder>();

  async saveSubscription(deviceId: string, sub: WebPushSubscription) {
    this.subs.set(deviceId, sub);
  }

  async getSubscription(deviceId: string) {
    return this.subs.get(deviceId) ?? null;
  }

  async deleteDevice(deviceId: string) {
    this.subs.delete(deviceId);
    for (const [id, r] of this.reminders) {
      if (r.deviceId === deviceId) this.reminders.delete(id);
    }
  }

  async saveReminder(reminder: Reminder) {
    this.reminders.set(reminder.id, reminder);
  }

  async listReminders(deviceId: string) {
    return [...this.reminders.values()]
      .filter((r) => r.deviceId === deviceId)
      .sort((a, b) => a.at - b.at);
  }

  async deleteReminder(deviceId: string, id: string) {
    if (this.reminders.get(id)?.deviceId === deviceId) this.reminders.delete(id);
  }

  async dueReminders(now: number) {
    return [...this.reminders.values()].filter((r) => r.at <= now);
  }
}

function createStore(): Store {
  const hasRedis =
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  if (hasRedis) return new RedisStore(Redis.fromEnv());
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[store] No Upstash Redis env vars set; using in-memory store. Reminders will not persist.",
    );
  }
  return new MemoryStore();
}

// Shared across hot reloads and between server actions, route handlers and instrumentation.
const globalForStore = globalThis as unknown as { __pwaStore?: Store };
export const store = (globalForStore.__pwaStore ??= createStore());
