import "server-only";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Redis } from "@upstash/redis";
import type { PushSubscription as WebPushSubscription } from "web-push";

export type Repeat = "none" | "daily";

export type Reminder = {
  id: string;
  /** Owner; the reminder goes to every device they have notifications on. */
  userId?: string;
  /** Only on reminders made before accounts, until someone logs in on that device. */
  deviceId?: string;
  title: string;
  body: string;
  /** Next fire time, epoch ms. */
  at: number;
  repeat: Repeat;
};

/** A device opted in to the quote sent when the day changes in its time zone. */
export type DailyQuoteSetting = {
  timeZone: string;
  /** Local date (YYYY-MM-DD) of the last daily quote sent. */
  lastSent: string;
};

export interface Store {
  /** Saves the device's push subscription and links the device to the person logged in on it. */
  saveSubscription(deviceId: string, sub: WebPushSubscription, userId: string): Promise<void>;
  getSubscription(deviceId: string): Promise<WebPushSubscription | null>;
  /** Devices where this person has notifications on. */
  listUserDevices(userId: string): Promise<string[]>;
  /** Removes the subscription, its daily quote and any reminders made on it before accounts. */
  deleteDevice(deviceId: string): Promise<void>;
  saveReminder(reminder: Reminder): Promise<void>;
  listReminders(userId: string): Promise<Reminder[]>;
  /** With userId, only deletes the reminder if it belongs to them. */
  deleteReminder(id: string, userId?: string): Promise<void>;
  /** Gives reminders made on this device before accounts to the person now using it. */
  claimReminders(deviceId: string, userId: string): Promise<void>;
  dueReminders(now: number): Promise<Reminder[]>;
  getDailyQuote(deviceId: string): Promise<DailyQuoteSetting | null>;
  /** Pass null to opt the device out. */
  setDailyQuote(deviceId: string, setting: DailyQuoteSetting | null): Promise<void>;
  listDailyQuotes(): Promise<[deviceId: string, setting: DailyQuoteSetting][]>;
}

// Redis layout:
//   sub:{deviceId}         -> push subscription JSON
//   deviceuser             -> hash of deviceId -> userId
//   user:{userId}:devices  -> set of deviceIds
//   reminder:{id}          -> reminder JSON
//   user:{userId}:rems     -> set of reminder ids
//   device:{deviceId}:rems -> set of reminder ids made before accounts
//   due                    -> sorted set of reminder ids, scored by `at`
//   dailyquote             -> hash of deviceId -> daily quote setting JSON
class RedisStore implements Store {
  constructor(private redis: Redis) {}

  async saveSubscription(deviceId: string, sub: WebPushSubscription, userId: string) {
    const previous = await this.redis.hget<string>("deviceuser", deviceId);
    const tx = this.redis.multi();
    tx.set(`sub:${deviceId}`, sub);
    tx.hset("deviceuser", { [deviceId]: userId });
    if (previous && previous !== userId) tx.srem(`user:${previous}:devices`, deviceId);
    tx.sadd(`user:${userId}:devices`, deviceId);
    await tx.exec();
  }

  async getSubscription(deviceId: string) {
    return this.redis.get<WebPushSubscription>(`sub:${deviceId}`);
  }

  async listUserDevices(userId: string) {
    return this.redis.smembers(`user:${userId}:devices`);
  }

  async deleteDevice(deviceId: string) {
    const ids = await this.redis.smembers(`device:${deviceId}:rems`);
    const userId = await this.redis.hget<string>("deviceuser", deviceId);
    const tx = this.redis.multi();
    tx.del(`sub:${deviceId}`, `device:${deviceId}:rems`);
    tx.hdel("dailyquote", deviceId);
    tx.hdel("deviceuser", deviceId);
    if (userId) tx.srem(`user:${userId}:devices`, deviceId);
    for (const id of ids) {
      tx.del(`reminder:${id}`);
      tx.zrem("due", id);
    }
    await tx.exec();
  }

  async saveReminder(reminder: Reminder) {
    const tx = this.redis.multi();
    tx.set(`reminder:${reminder.id}`, reminder);
    tx.sadd(reminder.userId ? `user:${reminder.userId}:rems` : `device:${reminder.deviceId}:rems`, reminder.id);
    tx.zadd("due", { score: reminder.at, member: reminder.id });
    await tx.exec();
  }

  private async remindersIn(key: string) {
    const ids = await this.redis.smembers(key);
    if (ids.length === 0) return [];
    const rows = await this.redis.mget<(Reminder | null)[]>(
      ...ids.map((id) => `reminder:${id}`),
    );
    return rows.filter((r): r is Reminder => r !== null);
  }

  async listReminders(userId: string) {
    return (await this.remindersIn(`user:${userId}:rems`)).sort((a, b) => a.at - b.at);
  }

  async deleteReminder(id: string, userId?: string) {
    const reminder = await this.redis.get<Reminder>(`reminder:${id}`);
    if (!reminder || (userId && reminder.userId !== userId)) return;
    const tx = this.redis.multi();
    tx.del(`reminder:${id}`);
    tx.srem(reminder.userId ? `user:${reminder.userId}:rems` : `device:${reminder.deviceId}:rems`, id);
    tx.zrem("due", id);
    await tx.exec();
  }

  async claimReminders(deviceId: string, userId: string) {
    const reminders = await this.remindersIn(`device:${deviceId}:rems`);
    if (reminders.length === 0) return;
    const tx = this.redis.multi();
    for (const reminder of reminders) {
      // JSON drops the undefined deviceId.
      tx.set(`reminder:${reminder.id}`, { ...reminder, deviceId: undefined, userId });
      tx.sadd(`user:${userId}:rems`, reminder.id);
    }
    tx.del(`device:${deviceId}:rems`);
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

  async getDailyQuote(deviceId: string) {
    return this.redis.hget<DailyQuoteSetting>("dailyquote", deviceId);
  }

  async setDailyQuote(deviceId: string, setting: DailyQuoteSetting | null) {
    if (setting) await this.redis.hset("dailyquote", { [deviceId]: setting });
    else await this.redis.hdel("dailyquote", deviceId);
  }

  async listDailyQuotes() {
    const all = await this.redis.hgetall<Record<string, DailyQuoteSetting>>("dailyquote");
    return Object.entries(all ?? {});
  }
}

// Local development fallback. Data lives in process memory and is lost on restart.
class MemoryStore implements Store {
  protected subs = new Map<string, WebPushSubscription>();
  protected deviceUsers = new Map<string, string>();
  protected reminders = new Map<string, Reminder>();
  protected dailyQuotes = new Map<string, DailyQuoteSetting>();

  /** Called after every write; FileStore persists here. */
  protected changed() {}

  async saveSubscription(deviceId: string, sub: WebPushSubscription, userId: string) {
    this.subs.set(deviceId, sub);
    this.deviceUsers.set(deviceId, userId);
    this.changed();
  }

  async getSubscription(deviceId: string) {
    return this.subs.get(deviceId) ?? null;
  }

  async listUserDevices(userId: string) {
    return [...this.deviceUsers].filter(([, u]) => u === userId).map(([deviceId]) => deviceId);
  }

  async deleteDevice(deviceId: string) {
    this.subs.delete(deviceId);
    this.deviceUsers.delete(deviceId);
    this.dailyQuotes.delete(deviceId);
    for (const [id, r] of this.reminders) {
      if (!r.userId && r.deviceId === deviceId) this.reminders.delete(id);
    }
    this.changed();
  }

  async saveReminder(reminder: Reminder) {
    this.reminders.set(reminder.id, reminder);
    this.changed();
  }

  async listReminders(userId: string) {
    return [...this.reminders.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => a.at - b.at);
  }

  async deleteReminder(id: string, userId?: string) {
    const reminder = this.reminders.get(id);
    if (!reminder || (userId && reminder.userId !== userId)) return;
    this.reminders.delete(id);
    this.changed();
  }

  async claimReminders(deviceId: string, userId: string) {
    let claimed = false;
    for (const [id, { deviceId: device, ...reminder }] of this.reminders) {
      if (reminder.userId || device !== deviceId) continue;
      this.reminders.set(id, { ...reminder, userId });
      claimed = true;
    }
    if (claimed) this.changed();
  }

  async dueReminders(now: number) {
    return [...this.reminders.values()].filter((r) => r.at <= now);
  }

  async getDailyQuote(deviceId: string) {
    return this.dailyQuotes.get(deviceId) ?? null;
  }

  async setDailyQuote(deviceId: string, setting: DailyQuoteSetting | null) {
    if (setting) this.dailyQuotes.set(deviceId, setting);
    else this.dailyQuotes.delete(deviceId);
    this.changed();
  }

  async listDailyQuotes() {
    return [...this.dailyQuotes];
  }
}

// Single-server deployments (e.g. a VM): memory store persisted to a JSON file.
class FileStore extends MemoryStore {
  constructor(private file: string) {
    super();
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as {
        subs: [string, WebPushSubscription][];
        deviceUsers?: [string, string][];
        reminders: [string, Reminder][];
        dailyQuotes?: [string, DailyQuoteSetting][];
      };
      this.subs = new Map(data.subs);
      this.deviceUsers = new Map(data.deviceUsers ?? []);
      this.reminders = new Map(data.reminders);
      this.dailyQuotes = new Map(data.dailyQuotes ?? []);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  protected changed() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({
        subs: [...this.subs],
        deviceUsers: [...this.deviceUsers],
        reminders: [...this.reminders],
        dailyQuotes: [...this.dailyQuotes],
      }),
    );
    // Rename is atomic, so a crash mid-write never leaves a half-written file.
    renameSync(tmp, this.file);
  }
}

function createStore(): Store {
  const hasRedis =
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  if (hasRedis) return new RedisStore(Redis.fromEnv());
  if (process.env.DATA_FILE) return new FileStore(process.env.DATA_FILE);
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[store] Neither Upstash Redis nor DATA_FILE is set; using in-memory store. Reminders will not persist.",
    );
  }
  return new MemoryStore();
}

// Shared across hot reloads and between server actions, route handlers and instrumentation.
const globalForStore = globalThis as unknown as { __pwaStore?: Store };
export const store = (globalForStore.__pwaStore ??= createStore());
