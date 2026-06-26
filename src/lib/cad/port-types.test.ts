import { describe, it, expect } from 'vitest';
import {
  canFeed, canWire, portType, registerPortType, allPortTypes,
  defineRecordType, listOf,
  PT_SCALAR, PT_LIST_POINT, PT_GEOMETRY, type PortType,
} from './port-types';

describe('port-types registry', () => {
  it('registers + looks up the 3 core types by id', () => {
    expect(portType('scalar')).toBe(PT_SCALAR);
    expect(portType('list<point>')).toBe(PT_LIST_POINT);
    expect(portType('geometry')).toBe(PT_GEOMETRY);
    expect(portType('nope')).toBeUndefined();
    expect(allPortTypes().length).toBeGreaterThanOrEqual(3);
  });

  it('same type feeds itself; different elem shapes do not', () => {
    expect(canFeed(PT_SCALAR, PT_SCALAR)).toBe(true);
    expect(canFeed(PT_LIST_POINT, PT_LIST_POINT)).toBe(true);
    expect(canFeed(PT_GEOMETRY, PT_GEOMETRY)).toBe(true);
    // a point-list can't feed a geometry slot, etc.
    expect(canFeed(PT_LIST_POINT, PT_GEOMETRY)).toBe(false);
    expect(canFeed(PT_SCALAR, PT_GEOMETRY)).toBe(false);
    expect(canFeed(PT_SCALAR, PT_LIST_POINT)).toBe(false); // scalar ≠ point elem
  });

  it('broadcasts a single value into a list slot of the SAME elem, not the reverse', () => {
    const oneP: PortType = { id: 'point', elem: 'point', card: 'one', label: 'point', color: '#000' };
    expect(canFeed(oneP, PT_LIST_POINT)).toBe(true);   // one point → list<point> (broadcast)
    expect(canFeed(PT_LIST_POINT, oneP)).toBe(false);  // list never collapses into a single slot
  });

  it('canWire resolves by id + is false for unknown ids', () => {
    expect(canWire('list<point>', 'list<point>')).toBe(true);
    expect(canWire('list<point>', 'geometry')).toBe(false);
    expect(canWire('list<point>', 'ghost')).toBe(false);
    expect(canWire('ghost', 'scalar')).toBe(false);
  });

  it('composite (record) types are NOMINAL — same name only, never structurally-similar', () => {
    const fields = [{ name: 'r', typeId: 'scalar' }, { name: 'z', typeId: 'scalar' }];
    const Point2 = defineRecordType('Point2', 'point', fields);
    const Vertex = defineRecordType('Vertex', 'vertex', fields); // SAME shape, different name
    expect(portType('Point2')?.fields).toEqual(fields);
    expect(canFeed(Point2, Point2)).toBe(true);
    expect(canFeed(Point2, Vertex)).toBe(false);   // identical fields, but distinct names ⇒ no
    expect(canFeed(Point2, PT_GEOMETRY)).toBe(false);
  });

  it('listOf derives a registered list type; record-lists stay nominal, point-broadcast works', () => {
    const Casing = defineRecordType('Casing', 'casing', [{ name: 'od', typeId: 'scalar' }]);
    const Joint = defineRecordType('Joint', 'joint', [{ name: 'od', typeId: 'scalar' }]);
    const listCasing = listOf('Casing')!;
    const listJoint = listOf('Joint')!;
    expect(listCasing.id).toBe('list<Casing>');
    expect(listCasing.card).toBe('list');
    expect(listCasing.of).toBe('Casing');
    expect(listOf('Casing')).toBe(listCasing);          // idempotent
    expect(listOf('does-not-exist')).toBeUndefined();
    expect(canFeed(listCasing, listCasing)).toBe(true);
    expect(canFeed(listCasing, listJoint)).toBe(false); // distinct record lists don't mix
    expect(canFeed(Casing, listCasing)).toBe(true);     // one Casing → list<Casing> broadcast
    expect(canFeed(Casing, listJoint)).toBe(false);     // one Casing ↛ list<Joint>
  });

  it('listOf<point> keeps primitive structural compat (matches PT_LIST_POINT id)', () => {
    const lp = listOf('scalar')!;
    expect(lp.id).toBe('list<scalar>');
    expect(canFeed(PT_SCALAR, lp)).toBe(true);          // scalar broadcasts into list<scalar>
  });

  it('honours a per-type feeds() override', () => {
    const wild = registerPortType({
      id: 'wild', elem: 'object', card: 'one', label: 'wild', color: '#000',
      feeds: () => true,
    });
    expect(canFeed(wild, PT_GEOMETRY)).toBe(true);       // override says yes
    expect(canFeed(PT_GEOMETRY, wild)).toBe(false);      // default still applies the other way
  });
});
