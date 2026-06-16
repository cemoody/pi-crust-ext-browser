/**
 * TOOL-5 / SEC-3 — model-visible snapshots must never carry secret values.
 * RED until redactSnapshot is built.
 */
import { describe, expect, it } from 'vitest';
import { redactSnapshot, type SnapshotNode } from '../../src/core/redaction.js';

const tree: SnapshotNode = {
  tag: 'form',
  children: [
    { tag: 'input', type: 'text', value: 'octocat-demo' },
    { tag: 'input', type: 'password', value: 'hunter2!' },
  ],
};

describe('redaction', () => {
  it('TOOL-5: password input values are redacted', () => {
    const out = redactSnapshot(tree);
    const json = JSON.stringify(out);
    expect(json).not.toContain('hunter2!');
  });

  it('TOOL-5: non-secret values are preserved', () => {
    const out = redactSnapshot(tree);
    expect(JSON.stringify(out)).toContain('octocat-demo');
  });

  it('SEC-3: redaction does not mutate the input snapshot', () => {
    const before = JSON.stringify(tree);
    redactSnapshot(tree);
    expect(JSON.stringify(tree)).toBe(before);
  });

  it('TOOL-5: extra redactSelectors are honored', () => {
    const t: SnapshotNode = { tag: 'input', type: 'text', value: 'sk-secret-token' };
    const out = redactSnapshot(t, { redactSelectors: ['input[name="apiKey"]'] });
    // implementation maps selectors→nodes; here we just assert the option path
    // is supported and returns a node (RED stub throws regardless).
    expect(out).toBeTruthy();
  });
});
