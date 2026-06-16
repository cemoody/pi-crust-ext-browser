/**
 * Snapshot redaction (TOOL-5, SEC-3): page data returned to the MODEL must never
 * contain password values (or other configured secret fields).
 */
export interface SnapshotNode {
  tag?: string;
  type?: string; // input type attr
  name?: string;
  value?: string;
  text?: string;
  children?: SnapshotNode[];
}

const REDACTED = '«redacted»';

function isSecret(node: SnapshotNode, redactNames: Set<string>): boolean {
  if (node.tag === 'input' && (node.type ?? '').toLowerCase() === 'password') return true;
  if (node.name && redactNames.has(node.name)) return true;
  return false;
}

// Parse an `input[name="x"]` selector into the name it targets (the subset we
// support for redactSelectors). Unknown selector shapes are ignored.
function namesFromSelectors(selectors: string[] | undefined): Set<string> {
  const names = new Set<string>();
  for (const sel of selectors ?? []) {
    const m = /\[name=["']?([^"'\]]+)["']?\]/.exec(sel);
    if (m) names.add(m[1]);
  }
  return names;
}

/**
 * Return a model-safe COPY of a DOM/aria snapshot with secret field values
 * replaced by a redaction marker. Does not mutate the input.
 */
export function redactSnapshot(
  snapshot: SnapshotNode,
  opts?: { redactSelectors?: string[] },
): SnapshotNode {
  const redactNames = namesFromSelectors(opts?.redactSelectors);

  const walk = (node: SnapshotNode): SnapshotNode => {
    const copy: SnapshotNode = { ...node };
    if (copy.value !== undefined && isSecret(node, redactNames)) {
      copy.value = REDACTED;
    }
    if (node.children) copy.children = node.children.map(walk);
    return copy;
  };

  return walk(snapshot);
}
