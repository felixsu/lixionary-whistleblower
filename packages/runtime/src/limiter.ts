import type { RedisClientType } from "redis";
export function redisLimiter(client: Pick<RedisClientType, "eval">) {
  return {
    async hit(key: string, max: number, seconds: number) {
      const n = await client.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
        { keys: [`limit:${key}`], arguments: [String(seconds)] },
      );
      return Number(n) <= max;
    },
  };
}
