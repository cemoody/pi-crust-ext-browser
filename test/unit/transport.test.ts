/**
 * DEPLOY-1 — same-origin transport (no hardcoded host/port). RED until built.
 */
import { describe, expect, it } from 'vitest';
import { gatewaySocketPath, liveViewRouteUrl, resolveGatewayOrigin } from '../../src/core/transport.js';

describe('transport URLs', () => {
  it('DEPLOY-1: gateway path is the shared /socket.io/ mount', () => {
    expect(gatewaySocketPath()).toBe('/socket.io/');
  });

  it('DEPLOY-1: gateway origin echoes the page origin (never hardcoded)', () => {
    expect(resolveGatewayOrigin('https://pi.example.com')).toBe('https://pi.example.com');
    expect(resolveGatewayOrigin('http://10.0.0.5:9999')).toBe('http://10.0.0.5:9999');
  });

  it('DEPLOY-1: resolveGatewayOrigin never returns the prototype localhost:4000', () => {
    const out = resolveGatewayOrigin('https://behind-a-proxy.tld');
    expect(out).not.toContain('4000');
    expect(out).not.toContain('127.0.0.1');
  });

  it('DEPLOY-1/SEC-8: live-view route is a relative /api/ path carrying the token', () => {
    const url = liveViewRouteUrl('pi-1', 'tok-abc');
    expect(url.startsWith('/api/')).toBe(true);
    expect(url).toContain('pi-1');
    expect(url).toContain('tok-abc');
    expect(url).not.toMatch(/^https?:\/\//); // relative, host resolves it
  });
});
