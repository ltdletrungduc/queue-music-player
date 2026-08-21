/**
 * Whether a request came from the machine the Room is running on.
 *
 * The speaker and its audio must stay here. A tunnel makes the Room reachable
 * from anywhere, and a second Player claiming the speaker from across the
 * internet would pull every byte of audio back out through this machine's own
 * connection — the one thing ADR-0002 says is scarce.
 *
 * A loopback address is not enough on its own: a tunnel proxies from localhost,
 * so everything it forwards arrives looking local. What gives it away is that
 * forwarding leaves a trail.
 */
const FORWARDED_HEADERS = ['x-forwarded-for', 'cf-connecting-ip', 'forwarded', 'x-real-ip'];

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isFromThisMachine(
  address: string | undefined,
  headers: Record<string, unknown>
): boolean {
  if (!address || !LOOPBACK.has(address)) return false;
  return !FORWARDED_HEADERS.some((header) => headers[header] !== undefined);
}
