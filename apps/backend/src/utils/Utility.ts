export default class Utility {
  static skipNulls<T extends object>(
    obj: T,
  ): { [K in keyof T]: T[K] extends null ? undefined : T[K] } {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, value === null ? undefined : value]),
    ) as any;
  }
}
