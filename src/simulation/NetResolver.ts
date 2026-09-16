/**
 * Net resolution.
 *
 * Turns the physical circuit into a list of electrical nodes. Everything that can
 * carry a signal takes part:
 *
 *  - breadboard connectivity groups (one clip = one node);
 *  - component pins (joined to a group when the pin sits in a hole);
 *  - wires (join their two endpoints);
 *  - junctions (join a branch to the wire it sits on);
 *  - conducting paths inside a part - bonded pins and closed switch contacts.
 *
 * A resistor is deliberately *not* a merge: it is a weak coupling handled by the
 * solver, so a pull-up does not become indistinguishable from a piece of wire.
 */

import type { Circuit } from '../core/Circuit';
import { pinsOf } from '../components/ComponentDefinition';
import { ConnectionRef, connectionRefId } from '../core/types';
import type { DeviceLink } from './deviceModels';

export interface NetPinRef {
  componentId: string;
  pin: number;
}

export interface Net {
  id: string;
  /** Canonical node keys that were merged into this net. */
  nodes: string[];
  groupIds: string[];
  pins: NetPinRef[];
  wireIds: string[];
  junctionIds: string[];
  /** Weak links (resistors) that touch this net: [componentId, thisPin, otherPin]. */
  resistiveLinks: { componentId: string; here: number; there: number }[];
}

export class NetList {
  readonly nets: Net[];
  private netIdByNode = new Map<string, string>();
  private netById = new Map<string, Net>();
  private netIdByPin = new Map<string, string>();

  constructor(nets: Net[], nodeToNet: Map<string, string>) {
    this.nets = nets;
    this.netIdByNode = nodeToNet;
    for (const net of nets) {
      this.netById.set(net.id, net);
      for (const pin of net.pins) this.netIdByPin.set(pinKey(pin.componentId, pin.pin), net.id);
    }
  }

  get(netId: string): Net | undefined {
    return this.netById.get(netId);
  }

  netIdOfNode(node: string): string | undefined {
    return this.netIdByNode.get(node);
  }

  netOfPin(componentId: string, pin: number): Net | undefined {
    const id = this.netIdByPin.get(pinKey(componentId, pin));
    return id ? this.netById.get(id) : undefined;
  }

  netIdOfPin(componentId: string, pin: number): string | undefined {
    return this.netIdByPin.get(pinKey(componentId, pin));
  }

  netOfGroup(groupId: string): Net | undefined {
    const id = this.netIdByNode.get(groupNode(groupId));
    return id ? this.netById.get(id) : undefined;
  }

  netOfWire(wireId: string): Net | undefined {
    return this.nets.find((n) => n.wireIds.includes(wireId));
  }

  netOfJunction(junctionId: string): Net | undefined {
    const id = this.netIdByNode.get(`j:${junctionId}`);
    return id ? this.netById.get(id) : undefined;
  }
}

function pinKey(componentId: string, pin: number): string {
  return `${componentId}#${pin}`;
}

export function groupNode(groupId: string): string {
  return `g:${groupId}`;
}

export function pinNode(componentId: string, pin: number): string {
  return `p:${componentId}:${pin}`;
}

class UnionFind {
  private parent = new Map<string, string>();

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    this.add(key);
    let root = key;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression keeps repeated lookups cheap on large boards.
    let cursor = key;
    while (this.parent.get(cursor) !== root) {
      const next = this.parent.get(cursor)!;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }

  keys(): string[] {
    return [...this.parent.keys()];
  }
}

export interface ResolveOptions {
  /** Conducting paths inside parts, supplied by the device models. */
  links: Map<string, DeviceLink[]>;
}

export function resolveNets(circuit: Circuit, options: ResolveOptions): NetList {
  const uf = new UnionFind();

  // Every clip on every board is a node, whether or not anything is plugged in.
  for (const board of circuit.boards) {
    for (const group of board.allGroups()) uf.add(groupNode(group.id));
  }

  // A pin in a hole joins that clip.
  for (const instance of circuit.components) {
    const def = circuit.definitionOf(instance);
    for (const pin of pinsOf(def, instance.properties)) uf.add(pinNode(instance.id, pin.number));
    if (def.footprint.mount === 'through-hole') {
      for (const location of circuit.pinPositions(instance)) {
        const found = circuit.holeAt(location.position.x, location.position.y);
        if (found) uf.union(pinNode(instance.id, location.pinNumber), groupNode(found.hole.groupId));
      }
    }
    // Pins bonded inside the package are one node by construction.
    for (const [a, b] of def.footprint.internalBonds ?? []) {
      uf.union(pinNode(instance.id, a), pinNode(instance.id, b));
    }
  }

  // Conducting paths that depend on state: closed switch contacts, pressed buttons.
  const resistive: { componentId: string; a: number; b: number }[] = [];
  for (const [componentId, links] of options.links) {
    for (const link of links) {
      if (link.kind === 'conductor') {
        uf.union(pinNode(componentId, link.a), pinNode(componentId, link.b));
      } else {
        resistive.push({ componentId, a: link.a, b: link.b });
      }
    }
  }

  // Wires and junctions.
  const wireNodes = new Map<string, string>();
  for (const wire of circuit.wires) {
    const from = nodeForRef(circuit, wire.from);
    const to = nodeForRef(circuit, wire.to);
    if (!from || !to) continue;
    uf.union(from, to);
    wireNodes.set(wire.id, from);
  }
  for (const junction of circuit.junctions) {
    const anchor = wireNodes.get(junction.wireId);
    if (!anchor) continue;
    uf.union(`j:${junction.id}`, anchor);
  }

  // Collect the members of every root.
  const members = new Map<string, string[]>();
  for (const key of uf.keys()) {
    const root = uf.find(key);
    const list = members.get(root) ?? [];
    list.push(key);
    members.set(root, list);
  }

  // Deterministic ids: sort by the alphabetically first node so two runs over the
  // same circuit always produce the same net names.
  const roots = [...members.entries()]
    .map(([root, nodes]) => ({ root, nodes: nodes.sort() }))
    .sort((a, b) => (a.nodes[0] < b.nodes[0] ? -1 : a.nodes[0] > b.nodes[0] ? 1 : 0));

  const nodeToNet = new Map<string, string>();
  const nets: Net[] = roots.map((entry, index) => {
    const id = `N${index + 1}`;
    const net: Net = {
      id,
      nodes: entry.nodes,
      groupIds: [],
      pins: [],
      wireIds: [],
      junctionIds: [],
      resistiveLinks: [],
    };
    for (const node of entry.nodes) {
      nodeToNet.set(node, id);
      if (node.startsWith('g:')) net.groupIds.push(node.slice(2));
      else if (node.startsWith('p:')) {
        const [, componentId, pin] = node.split(':');
        net.pins.push({ componentId, pin: Number(pin) });
      } else if (node.startsWith('j:')) net.junctionIds.push(node.slice(2));
    }
    return net;
  });

  const byId = new Map(nets.map((n) => [n.id, n]));
  for (const [wireId, node] of wireNodes) {
    const netId = nodeToNet.get(uf.find(node));
    const net = netId ? byId.get(netId) : undefined;
    if (net) net.wireIds.push(wireId);
  }
  for (const link of resistive) {
    const netA = nodeToNet.get(uf.find(pinNode(link.componentId, link.a)));
    const netB = nodeToNet.get(uf.find(pinNode(link.componentId, link.b)));
    if (netA) byId.get(netA)?.resistiveLinks.push({ componentId: link.componentId, here: link.a, there: link.b });
    if (netB) byId.get(netB)?.resistiveLinks.push({ componentId: link.componentId, here: link.b, there: link.a });
  }

  // `nodeToNet` is keyed by root; expand it so any node resolves directly.
  const expanded = new Map<string, string>();
  for (const key of uf.keys()) {
    const netId = nodeToNet.get(uf.find(key));
    if (netId) expanded.set(key, netId);
  }

  return new NetList(nets, expanded);
}

function nodeForRef(circuit: Circuit, ref: ConnectionRef): string | undefined {
  switch (ref.kind) {
    case 'hole': {
      const board = circuit.getBoard(ref.boardId);
      const hole = board?.getHole(ref.hole);
      return hole ? groupNode(hole.groupId) : undefined;
    }
    case 'pin': {
      const instance = circuit.getComponent(ref.componentId);
      return instance ? pinNode(ref.componentId, ref.pin) : undefined;
    }
    case 'junction':
      return circuit.getJunction(ref.junctionId) ? `j:${ref.junctionId}` : undefined;
  }
}

export function refNode(circuit: Circuit, ref: ConnectionRef): string {
  return nodeForRef(circuit, ref) ?? connectionRefId(ref);
}
