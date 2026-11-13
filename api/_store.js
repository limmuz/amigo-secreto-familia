// Camada de armazenamento.
// Em produção usa o Redis da Vercel (Upstash, via Marketplace).
// Sem as variáveis de ambiente, só funciona em memória no servidor local de testes.
import { Redis } from '@upstash/redis';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;

const mem = globalThis.__amigoMem || (globalThis.__amigoMem = new Map());
const memOk = process.env.LOCAL_DEV === '1';

export const hasDb = !!redis || memOk;

export const store = {
  async get(k) { return redis ? redis.get(k) : (mem.get(k) ?? null); },
  async set(k, v, ex) {
    if (redis) return ex ? redis.set(k, v, { ex }) : redis.set(k, v);
    mem.set(k, v);
  },
  async setnx(k, v, ex) {
    if (redis) return (await redis.set(k, v, { nx: true, ex })) === 'OK';
    if (mem.has(k)) return false;
    mem.set(k, v); setTimeout(() => mem.delete(k), ex * 1000).unref?.();
    return true;
  },
  async del(k) { return redis ? redis.del(k) : mem.delete(k); },
  async hget(k, f) { return redis ? redis.hget(k, f) : (mem.get(k)?.[f] ?? null); },
  async hset(k, obj) {
    if (redis) return redis.hset(k, obj);
    mem.set(k, { ...(mem.get(k) || {}), ...obj });
  },
  async hdel(k, f) {
    if (redis) return redis.hdel(k, f);
    const o = { ...(mem.get(k) || {}) }; delete o[f]; mem.set(k, o);
  },
  async hgetall(k) { return redis ? ((await redis.hgetall(k)) || {}) : { ...(mem.get(k) || {}) }; },
  async incr(k, ex) {
    if (redis) { const n = await redis.incr(k); if (n === 1) await redis.expire(k, ex); return n; }
    const n = (mem.get(k) || 0) + 1; mem.set(k, n);
    if (n === 1) setTimeout(() => mem.delete(k), ex * 1000).unref?.();
    return n;
  },
};
