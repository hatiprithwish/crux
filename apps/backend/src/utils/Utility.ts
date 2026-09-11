import { customAlphabet } from "nanoid";

const publicIdAlphabet = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  21,
);

export default class Utility {
  // DEV_NOTE: prefix is Stripe-style, e.g. "usr_" — makes passing a metric ID where a tracker ID was
  // expected fail loudly instead of silently returning nothing. See architecture.md §4 "Prefixes".
  static generatePublicId(prefix = ""): string {
    return `${prefix}${publicIdAlphabet()}`;
  }

  // DEV_NOTE: D1 caps a query at 100 bound parameters. Any `inArray(column, ids)` whose list grows
  // with the user's data — trackers on the Today screen, entries in a date range — silently works in
  // development and throws in production once the list gets long enough. Callers chunk with this and
  // concatenate the results rather than assuming their list is short.
  static chunk<T>(items: T[], size = 90): T[][] {
    if (items.length <= size) return items.length === 0 ? [] : [items];

    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  // DEV_NOTE: a package with a native equivalent is banned (CLAUDE.md), and this is ~20 lines — no
  // p-limit. Bounds how many sends the notification dispatcher has in flight at once; CPU cost per
  // send is sub-millisecond (one ECDH derive, three HKDFs, one AES-GCM), so this exists purely to cap
  // concurrent subrequests, not to spread out CPU work.
  static async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < items.length) {
        const current = nextIndex++;
        results[current] = await fn(items[current]);
      }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return results;
  }

  static skipNulls<T extends object>(
    obj: T,
  ): { [K in keyof T]: T[K] extends null ? undefined : T[K] } {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, value === null ? undefined : value]),
    ) as any;
  }
}
