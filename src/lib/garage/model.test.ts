import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decodeShareLink,
  emptyGarage,
  encodeShareLink,
  firstFreeSlot,
  fromExportedFile,
  fromShareable,
  isFull,
  isGarage,
  moveToSlot,
  park,
  remove,
  setCapacity,
  setOwned,
  toBackupFile,
  toShareable,
  toShareFile,
  updateOwnership,
  type Garage,
} from './model.ts';

/** A garage with every private field populated, for the leak tests. */
function garageWithOwnership(): Garage {
  let garage = emptyGarage(10);
  const a = park(garage, 'bmw-6-series-e24', { nickname: 'The shark', now: '2026-01-01T00:00:00Z' });
  assert.ok(a.ok);
  garage = a.garage;
  const b = park(garage, 'porsche-911-993', { now: '2026-01-02T00:00:00Z' });
  assert.ok(b.ok);
  garage = b.garage;

  garage = setOwned(garage, a.entry.uid, true);
  garage = updateOwnership(garage, a.entry.uid, {
    purchaseDate: '2019-06-01',
    purchasePrice: 28500,
    currentMileage: 143000,
    plate: 'SECRET-PLATE-123',
    serviceLog: [
      { date: '2025-03-11', mileage: 138000, type: 'Cambelt', cost: 940, notes: 'Indie specialist' },
    ],
    valueAnchors: [{ date: '2026-01-01', value: 31000 }],
  });
  return garage;
}

describe('capacity and slots', () => {
  it('starts empty at the first tier', () => {
    const garage = emptyGarage();
    assert.equal(garage.capacity, 10);
    assert.equal(garage.entries.length, 0);
    assert.equal(firstFreeSlot(garage), 0);
    assert.equal(isFull(garage), false);
  });

  it('fills the lowest free slot', () => {
    let garage = emptyGarage(10);
    const first = park(garage, 'car-a');
    assert.ok(first.ok);
    assert.equal(first.entry.slot, 0);
    garage = first.garage;
    const second = park(garage, 'car-b');
    assert.ok(second.ok);
    assert.equal(second.entry.slot, 1);
  });

  it('reuses a freed slot rather than growing past capacity', () => {
    let garage = emptyGarage(10);
    const a = park(garage, 'car-a');
    assert.ok(a.ok);
    const b = park(a.garage, 'car-b');
    assert.ok(b.ok);
    garage = remove(b.garage, a.entry.uid);
    assert.equal(firstFreeSlot(garage), 0);
  });

  it('refuses to park in a full garage rather than silently dropping a car', () => {
    let garage = emptyGarage(10);
    for (let i = 0; i < 10; i++) {
      const result = park(garage, `car-${i}`);
      assert.ok(result.ok);
      garage = result.garage;
    }
    assert.equal(isFull(garage), true);
    const overflow = park(garage, 'one-too-many');
    assert.equal(overflow.ok, false);
    assert.equal(garage.entries.length, 10);
  });

  it('displaces rather than overwrites when a taken slot is targeted', () => {
    // Losing a car to a misclick is unforgivable in a feature whose whole
    // purpose is remembering things.
    let garage = emptyGarage(10);
    const a = park(garage, 'car-a', { slot: 3 });
    assert.ok(a.ok);
    const b = park(a.garage, 'car-b', { slot: 3 });
    assert.ok(b.ok);
    garage = b.garage;
    assert.equal(garage.entries.length, 2);
    assert.equal(garage.entries.filter((e) => e.carRef === 'car-a').length, 1);
  });

  it('swaps on a move so neither entry is destroyed', () => {
    let garage = emptyGarage(10);
    const a = park(garage, 'car-a', { slot: 0 });
    assert.ok(a.ok);
    const b = park(a.garage, 'car-b', { slot: 1 });
    assert.ok(b.ok);
    garage = moveToSlot(b.garage, a.entry.uid, 1);
    assert.equal(garage.entries.find((e) => e.uid === a.entry.uid)?.slot, 1);
    assert.equal(garage.entries.find((e) => e.uid === b.entry.uid)?.slot, 0);
    assert.equal(garage.entries.length, 2);
  });

  it('reports evicted entries when shrinking rather than discarding them silently', () => {
    let garage = emptyGarage(20);
    const far = park(garage, 'car-far', { slot: 15 });
    assert.ok(far.ok);
    garage = far.garage;
    const { garage: shrunk, evicted } = setCapacity(garage, 10);
    assert.equal(shrunk.entries.length, 0);
    assert.equal(evicted.length, 1);
    assert.equal(evicted[0]!.carRef, 'car-far');
  });
});

describe('ownership', () => {
  it('adds an empty ownership block when switched on', () => {
    let garage = emptyGarage();
    const a = park(garage, 'car-a');
    assert.ok(a.ok);
    garage = setOwned(a.garage, a.entry.uid, true);
    const entry = garage.entries[0]!;
    assert.ok(entry.ownership);
    assert.deepEqual(entry.ownership.serviceLog, []);
    assert.deepEqual(entry.ownership.valueAnchors, []);
  });

  it('drops the block entirely when switched off', () => {
    const garage = garageWithOwnership();
    const owned = garage.entries.find((e) => e.ownership)!;
    const after = setOwned(garage, owned.uid, false);
    assert.equal(after.entries.find((e) => e.uid === owned.uid)?.ownership, undefined);
    assert.ok(!('ownership' in after.entries.find((e) => e.uid === owned.uid)!));
  });

  it('leaves other entries untouched', () => {
    const garage = garageWithOwnership();
    const notOwned = garage.entries.find((e) => !e.ownership);
    assert.ok(notOwned, 'the fixture should have one unowned car');
  });
});

// ---------------------------------------------------------------------------
// The privacy contract. Instruction.md Phase 5 asks for this explicitly:
// "Test explicitly that no ownership field survives a share."
// ---------------------------------------------------------------------------

describe('sharing never leaks ownership', () => {
  const PRIVATE_VALUES = [
    'SECRET-PLATE-123',
    '28500',
    '143000',
    'Cambelt',
    'Indie specialist',
    '31000',
    '2019-06-01',
  ];

  function assertNoPrivateData(serialized: string, what: string) {
    for (const secret of PRIVATE_VALUES) {
      assert.ok(
        !serialized.includes(secret),
        `${what} leaked a private value: ${secret}\nin: ${serialized}`,
      );
    }
    assert.ok(!serialized.includes('ownership'), `${what} leaked the ownership key`);
    assert.ok(!serialized.includes('plate'), `${what} leaked the plate key`);
    assert.ok(!serialized.includes('serviceLog'), `${what} leaked the service log key`);
    assert.ok(!serialized.includes('valueAnchors'), `${what} leaked value anchors`);
  }

  it('toShareable drops the whole ownership block', () => {
    const shared = toShareable(garageWithOwnership());
    assertNoPrivateData(JSON.stringify(shared), 'toShareable');
    for (const entry of shared.entries) {
      assert.ok(!('ownership' in entry));
    }
  });

  it('keeps exactly the fields a share is meant to carry', () => {
    const shared = toShareable(garageWithOwnership());
    assert.equal(shared.entries.length, 2);
    const keys = new Set(shared.entries.flatMap((e) => Object.keys(e)));
    for (const key of keys) {
      assert.ok(
        ['carRef', 'trimRef', 'slot', 'nickname'].includes(key),
        `unexpected key in a shared entry: ${key}`,
      );
    }
  });

  it('drops uid and addedAt, which mean nothing to a recipient', () => {
    const serialized = JSON.stringify(toShareable(garageWithOwnership()));
    assert.ok(!serialized.includes('uid'));
    assert.ok(!serialized.includes('addedAt'));
  });

  it('the share LINK contains no private data', () => {
    // The DoD's "a shared link inspected by hand contains zero ownership data",
    // checked against the decoded payload rather than the opaque base64.
    const encoded = encodeShareLink(garageWithOwnership());
    const decoded = decodeShareLink(encoded);
    assert.ok(decoded);
    assertNoPrivateData(JSON.stringify(decoded), 'the share link');
  });

  it('the share FILE contains no private data', () => {
    const file = toShareFile(garageWithOwnership());
    assert.equal(file.kind, 'markey-garage-share');
    assertNoPrivateData(JSON.stringify(file), 'the share file');
  });

  it('a share link survives a round trip with slots intact', () => {
    const original = garageWithOwnership();
    const decoded = decodeShareLink(encodeShareLink(original))!;
    assert.equal(decoded.capacity, original.capacity);
    assert.equal(decoded.entries.length, original.entries.length);
    assert.equal(decoded.entries[0]!.carRef, 'bmw-6-series-e24');
    assert.equal(decoded.entries[0]!.nickname, 'The shark');
  });

  it('rehydrating a share produces entries with no ownership at all', () => {
    const decoded = decodeShareLink(encodeShareLink(garageWithOwnership()))!;
    const rehydrated = fromShareable(decoded);
    assert.ok(rehydrated.entries.every((e) => e.ownership === undefined));
    assert.ok(isGarage(rehydrated));
  });

  it('rejects a malformed link instead of throwing', () => {
    assert.equal(decodeShareLink('not-base64!!'), null);
    assert.equal(decodeShareLink(''), null);
    assert.equal(decodeShareLink(btoa('{"c":999,"e":[]}')), null);
  });
});

describe('full backup does include ownership', () => {
  it('carries the private data a device transfer needs', () => {
    // The counterpart to the tests above: the backup path must NOT strip, or
    // moving between your own devices would silently lose your service history.
    const file = toBackupFile(garageWithOwnership());
    const serialized = JSON.stringify(file);
    assert.equal(file.kind, 'markey-garage-backup');
    assert.ok(serialized.includes('SECRET-PLATE-123'));
    assert.ok(serialized.includes('Cambelt'));
    assert.ok(serialized.includes('valueAnchors'));
  });
});

describe('importing', () => {
  it('reads a backup back and reports that it had ownership', () => {
    const result = fromExportedFile(toBackupFile(garageWithOwnership()));
    assert.ok(result.ok);
    assert.equal(result.hadOwnership, true);
    assert.equal(result.garage.entries.length, 2);
  });

  it('reads a share back and reports that it had none', () => {
    const result = fromExportedFile(toShareFile(garageWithOwnership()));
    assert.ok(result.ok);
    assert.equal(result.hadOwnership, false);
    assert.ok(result.garage.entries.every((e) => e.ownership === undefined));
  });

  it('rejects anything that is not a Markey export', () => {
    assert.equal(fromExportedFile(null).ok, false);
    assert.equal(fromExportedFile({}).ok, false);
    assert.equal(fromExportedFile({ kind: 'something-else' }).ok, false);
    assert.equal(fromExportedFile({ kind: 'markey-garage-backup', garage: { nope: 1 } }).ok, false);
  });
});

describe('isGarage', () => {
  it('accepts a real garage', () => {
    assert.equal(isGarage(garageWithOwnership()), true);
  });

  it('rejects an unknown capacity tier', () => {
    assert.equal(isGarage({ capacity: 13, entries: [] }), false);
  });

  it('rejects a malformed entry rather than partially accepting it', () => {
    assert.equal(isGarage({ capacity: 10, entries: [{ carRef: 'x' }] }), false);
  });

  it('rejects a malformed ownership block', () => {
    assert.equal(
      isGarage({
        capacity: 10,
        entries: [
          { uid: 'u', carRef: 'c', slot: 0, addedAt: 'now', ownership: { serviceLog: 'no' } },
        ],
      }),
      false,
    );
  });
});
