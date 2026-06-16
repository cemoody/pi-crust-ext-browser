/**
 * pi (agent) side: LLM-facing browser tools. These drive the server-owned
 * browser by RPC and emit the inline live-view artifact on login handoff.
 *
 * Scaffold: tools are registered with stub executors until the server RPC +
 * artifact wiring lands (see test/unit/tools.test.ts ids TOOL-* / HOFF-2).
 * Host API typed loosely so the package floats across pi versions.
 */
export default function browserPiExtension(pi: any): void {
  const notReady = (name: string) => async () => {
    throw new Error(`${name}: not implemented yet (pi-crust-ext-browser scaffold)`);
  };

  for (const name of [
    'browser_open',
    'browser_navigate',
    'browser_act',
    'browser_snapshot',
    'browser_request_login',
    'browser_wait_for_human',
  ]) {
    pi.registerTool?.({
      name,
      label: name,
      description: `${name} — pi-crust-ext-browser (scaffold; implementation in progress).`,
      parameters: { type: 'object', properties: {}, additionalProperties: true },
      execute: notReady(name),
    });
  }
}
