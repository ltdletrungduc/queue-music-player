import { describe, expect, it } from 'vitest';
import { emptyRoom, reduce } from './reduce.js';
import type { Ctx, RoomState } from './types.js';

const ctx = (now = 1_000): Ctx => ({ now, newId: () => 'generated-id' });

describe('an empty Room', () => {
  it('has an empty Queue', () => {
    expect(emptyRoom().queue).toEqual([]);
  });

  it('has nobody connected', () => {
    expect(emptyRoom().controllers).toEqual([]);
  });
});

describe('a Controller connecting', () => {
  it('appears in the Room', () => {
    const { state } = reduce(emptyRoom(), { type: 'controller/connected', controllerId: 'c1' }, ctx());
    expect(state.controllers).toEqual([{ id: 'c1', connectedAt: 1_000 }]);
  });

  it('causes everyone to be told the new state', () => {
    const { effects } = reduce(emptyRoom(), { type: 'controller/connected', controllerId: 'c1' }, ctx());
    expect(effects).toEqual([{ type: 'broadcast-snapshot' }]);
  });

  it('is recorded at the time the Room was told, not the wall clock', () => {
    const { state } = reduce(emptyRoom(), { type: 'controller/connected', controllerId: 'c1' }, ctx(55));
    expect(state.controllers[0]?.connectedAt).toBe(55);
  });

  it('does not appear twice when the same device reconnects', () => {
    const first = reduce(emptyRoom(), { type: 'controller/connected', controllerId: 'c1' }, ctx(1));
    const second = reduce(first.state, { type: 'controller/connected', controllerId: 'c1' }, ctx(2));
    expect(second.state.controllers).toEqual([{ id: 'c1', connectedAt: 2 }]);
  });
});

describe('a Controller disconnecting', () => {
  const withTwo = (): RoomState =>
    reduce(
      reduce(emptyRoom(), { type: 'controller/connected', controllerId: 'c1' }, ctx()).state,
      { type: 'controller/connected', controllerId: 'c2' },
      ctx()
    ).state;

  it('leaves the Room', () => {
    const { state } = reduce(withTwo(), { type: 'controller/disconnected', controllerId: 'c1' }, ctx());
    expect(state.controllers.map((c) => c.id)).toEqual(['c2']);
  });

  it('changes nothing when they were never here', () => {
    const before = withTwo();
    const { state, effects } = reduce(before, { type: 'controller/disconnected', controllerId: 'nobody' }, ctx());
    expect(state).toEqual(before);
    expect(effects).toEqual([]);
  });
});

describe('the reducer itself', () => {
  it('leaves the state it was given untouched', () => {
    const before = emptyRoom();
    const snapshot = structuredClone(before);
    reduce(before, { type: 'controller/connected', controllerId: 'c1' }, ctx());
    expect(before).toEqual(snapshot);
  });

  it('gives the same answer twice for the same inputs', () => {
    const a = reduce(emptyRoom(), { type: 'controller/connected', controllerId: 'c1' }, ctx(7));
    const b = reduce(emptyRoom(), { type: 'controller/connected', controllerId: 'c1' }, ctx(7));
    expect(a).toEqual(b);
  });
});
