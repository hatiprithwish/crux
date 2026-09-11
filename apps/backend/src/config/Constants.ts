export default class Constants {
  static readonly APP_REDACT_FIELDS = [/clerkId/i, /clerk_id/i];

  static readonly APP_NAME = "crux-worker" as const;

  // DEV_NOTE: Cloudflare invokes scheduled() once per configured cron expression with
  // controller.cron set to the expression string exactly as configured in wrangler.jsonc — these
  // constants are that string, shared between the switch in index.ts and the cron config itself so
  // the two can't drift silently. See wrangler.jsonc's own DEV_NOTE on the weekday-1-indexing trap.
  static readonly CRON_ORPHAN_SCAN = "0 0 * * SUN";
  static readonly CRON_NOTIFICATION_DISPATCH = "0 * * * *";
}
