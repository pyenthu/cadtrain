import { describe, it, expect } from 'vitest';
import {
  canFeed, canWire, portType, registerPortType, allPortTypes,
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

  it('honours a per-type feeds() override', () => {
    const wild = registerPortType({
      id: 'wild', elem: 'object', card: 'one', label: 'wild', color: '#000',
      feeds: () => true,
    });
    expect(canFeed(wild, PT_GEOMETRY)).toBe(true);       // override says yes
    expect(canFeed(PT_GEOMETRY, wild)).toBe(false);      // default still applies the other way
  });
});
