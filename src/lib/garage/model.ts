/**
 * My Garage — the data model and every operation on it.
 *
 * Pure functions over plain data. No DOM, no storage, no Svelte: the island
 * calls these, and so do the tests, which is the only way the sharing rule
 * below can be verified rather than merely intended.
 *
 * ## The rule this module exists to enforce
 *
 * A garage has two export paths and **they must never be confused**:
 *
 *  - **Share** — a link or file containing slots and cars *only*. The entire
 *    `ownership` block is stripped: no mileage, no purchase price, no plate,
 *    no service history. A shared garage is a top-ten list, not a personal
 *    record.
 *  - **Full backup** — a file, explicitly labelled, that *does* include
 *    ownership, for moving between the visitor's own devices.
 *
 * `toShareable()` builds its output from an **allowlist**, field by field. That
 * is the whole trick: a blocklist (`delete entry.ownership`) silently leaks the
 * day someone adds a second private field, whereas an allowlist silently drops
 * it, which is the safe direction to fail.
 */

export const GARAGE_FEATURE = 'garage';
export const GARAGE_VERSION = 1;

/** Fixed capacity tiers. */
export const CAPACITY_TIERS = [10, 20, 50] as const;
export type Capacity = (typeof CAPACITY_TIERS)[number];

export interface ServiceRecord {
  date: string;
  mileage?: number;
  type: string;
  cost?: number;
  notes?: string;
}

export interface ValueAnchor {
  date: string;
  value: number;
}

/** Present only when the visitor ticked "I own this car". */
export interface Ownership {
  purchaseDate?: string;
  purchasePrice?: number;
  currentMileage?: number;
  /** Never leaves the device in a share. */
  plate?: string;
  serviceLog: ServiceRecord[];
  valueAnchors: ValueAnchor[];
}

export interface GarageEntry {
  /** Random; the same car may legitimately be parked twice. */
  uid: string;
  carRef: string;
  trimRef?: string;
  slot: number;
  nickname?: string;
  addedAt: string;
  ownership?: Ownership;
}

export interface Garage {
  capacity: Capacity;
  entries: GarageEntry[];
}

export function emptyGarage(capacity: Capacity = 10): Garage {
  return { capacity, entries: [] };
}

// ---------------------------------------------------------------------------
// Validation — the guard the storage wrapper demands on every read
// ---------------------------------------------------------------------------

function isServiceRecord(value: unknown): value is ServiceRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as ServiceRecord;
  return typeof r.date === 'string' && typeof r.type === 'string';
}

function isValueAnchor(value: unknown): value is ValueAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as ValueAnchor;
  return typeof a.date === 'string' && typeof a.value === 'number';
}

function isOwnership(value: unknown): value is Ownership {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Ownership;
  return (
    Array.isArray(o.serviceLog) &&
    o.serviceLog.every(isServiceRecord) &&
    Array.isArray(o.valueAnchors) &&
    o.valueAnchors.every(isValueAnchor)
  );
}

export function isGarageEntry(value: unknown): value is GarageEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as GarageEntry;
  if (typeof e.uid !== 'string' || typeof e.carRef !== 'string') return false;
  if (typeof e.slot !== 'number' || typeof e.addedAt !== 'string') return false;
  if (e.ownership !== undefined && !isOwnership(e.ownership)) return false;
  return true;
}

export function isGarage(value: unknown): value is Garage {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Garage;
  if (!CAPACITY_TIERS.includes(g.capacity as Capacity)) return false;
  return Array.isArray(g.entries) && g.entries.every(isGarageEntry);
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function occupiedSlots(garage: Garage): Set<number> {
  return new Set(garage.entries.map((e) => e.slot));
}

/** The lowest free slot, or null when the garage is full. */
export function firstFreeSlot(garage: Garage): number | null {
  const taken = occupiedSlots(garage);
  for (let i = 0; i < garage.capacity; i++) {
    if (!taken.has(i)) return i;
  }
  return null;
}

export function isFull(garage: Garage): boolean {
  return firstFreeSlot(garage) === null;
}

function makeUid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `uid-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export type ParkResult =
  | { ok: true; garage: Garage; entry: GarageEntry }
  | { ok: false; reason: 'full' };

export function park(
  garage: Garage,
  carRef: string,
  options: { trimRef?: string; slot?: number; nickname?: string; now?: string } = {},
): ParkResult {
  const slot = options.slot ?? firstFreeSlot(garage);
  if (slot === null || slot < 0 || slot >= garage.capacity) return { ok: false, reason: 'full' };

  const entry: GarageEntry = {
    uid: makeUid(),
    carRef,
    trimRef: options.trimRef,
    slot,
    nickname: options.nickname,
    addedAt: options.now ?? new Date().toISOString(),
  };

  // Taking an occupied slot displaces whatever was there to the next free one
  // rather than overwriting it — losing a car to a misclick is unforgivable in
  // a feature whose entire purpose is remembering things.
  const displaced = garage.entries.find((e) => e.slot === slot);
  let entries = [...garage.entries];
  if (displaced) {
    const spare = firstFreeSlot(garage);
    if (spare === null) return { ok: false, reason: 'full' };
    entries = entries.map((e) => (e.uid === displaced.uid ? { ...e, slot: spare } : e));
  }

  return { ok: true, garage: { ...garage, entries: [...entries, entry] }, entry };
}

export function remove(garage: Garage, uid: string): Garage {
  return { ...garage, entries: garage.entries.filter((e) => e.uid !== uid) };
}

/** Swaps if the target slot is taken, so a drag can never destroy an entry. */
export function moveToSlot(garage: Garage, uid: string, slot: number): Garage {
  if (slot < 0 || slot >= garage.capacity) return garage;
  const moving = garage.entries.find((e) => e.uid === uid);
  if (!moving) return garage;
  const occupant = garage.entries.find((e) => e.slot === slot && e.uid !== uid);

  return {
    ...garage,
    entries: garage.entries.map((e) => {
      if (e.uid === uid) return { ...e, slot };
      if (occupant && e.uid === occupant.uid) return { ...e, slot: moving.slot };
      return e;
    }),
  };
}

export function updateEntry(
  garage: Garage,
  uid: string,
  patch: Partial<Omit<GarageEntry, 'uid'>>,
): Garage {
  return {
    ...garage,
    entries: garage.entries.map((e) => (e.uid === uid ? { ...e, ...patch } : e)),
  };
}

/** Turns ownership on with an empty block, or off by dropping it entirely. */
export function setOwned(garage: Garage, uid: string, owned: boolean): Garage {
  return {
    ...garage,
    entries: garage.entries.map((e) => {
      if (e.uid !== uid) return e;
      if (!owned) {
        const { ownership: _dropped, ...rest } = e;
        return rest;
      }
      return e.ownership ? e : { ...e, ownership: { serviceLog: [], valueAnchors: [] } };
    }),
  };
}

export function updateOwnership(
  garage: Garage,
  uid: string,
  patch: Partial<Ownership>,
): Garage {
  return {
    ...garage,
    entries: garage.entries.map((e) =>
      e.uid === uid && e.ownership ? { ...e, ownership: { ...e.ownership, ...patch } } : e,
    ),
  };
}

/**
 * Changes capacity tier.
 *
 * Shrinking never silently discards cars: entries beyond the new capacity are
 * returned separately so the UI can ask what to do with them.
 */
export function setCapacity(
  garage: Garage,
  capacity: Capacity,
): { garage: Garage; evicted: GarageEntry[] } {
  const kept = garage.entries.filter((e) => e.slot < capacity);
  const evicted = garage.entries.filter((e) => e.slot >= capacity);
  return { garage: { capacity, entries: kept }, evicted };
}

// ---------------------------------------------------------------------------
// Sharing — the privacy-critical part
// ---------------------------------------------------------------------------

/** Exactly what a share is allowed to contain. Nothing else can get in. */
export interface ShareableEntry {
  carRef: string;
  trimRef?: string;
  slot: number;
  nickname?: string;
}

export interface ShareableGarage {
  capacity: Capacity;
  entries: ShareableEntry[];
}

/**
 * Strips a garage down to what may be shared.
 *
 * Built field by field from an allowlist. Never `delete entry.ownership` — a
 * blocklist leaks the first time someone adds a second private field, and this
 * fails the other way.
 *
 * `uid` and `addedAt` are dropped too: neither is meaningful to a recipient,
 * and `addedAt` is a timestamp of the sharer's activity that nobody needs.
 */
export function toShareable(garage: Garage): ShareableGarage {
  return {
    capacity: garage.capacity,
    entries: garage.entries
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => {
        const shareable: ShareableEntry = { carRef: entry.carRef, slot: entry.slot };
        if (entry.trimRef) shareable.trimRef = entry.trimRef;
        if (entry.nickname) shareable.nickname = entry.nickname;
        return shareable;
      }),
  };
}

/** Rehydrates a shared garage into a real one. Never carries ownership. */
export function fromShareable(shared: ShareableGarage, now = new Date().toISOString()): Garage {
  return {
    capacity: shared.capacity,
    entries: shared.entries.map((entry) => ({
      uid: makeUid(),
      carRef: entry.carRef,
      trimRef: entry.trimRef,
      slot: entry.slot,
      nickname: entry.nickname,
      addedAt: now,
    })),
  };
}

export function isShareableGarage(value: unknown): value is ShareableGarage {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as ShareableGarage;
  if (!CAPACITY_TIERS.includes(g.capacity as Capacity)) return false;
  if (!Array.isArray(g.entries)) return false;
  return g.entries.every(
    (e) =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as ShareableEntry).carRef === 'string' &&
      typeof (e as ShareableEntry).slot === 'number',
  );
}

// --- URL encoding ---------------------------------------------------------

/** base64url, so a garage survives being pasted into a chat window. */
function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Encodes a garage for a URL.
 *
 * Goes through `toShareable()` rather than taking a `ShareableGarage`, so a
 * caller cannot construct the payload themselves and accidentally include
 * something private. There is exactly one path from a garage to a link.
 */
export function encodeShareLink(garage: Garage): string {
  const compact = toShareable(garage).entries.map((e) =>
    [e.carRef, e.slot, e.trimRef ?? '', e.nickname ?? ''].join('~'),
  );
  return toBase64Url(JSON.stringify({ c: garage.capacity, e: compact }));
}

export function decodeShareLink(encoded: string): ShareableGarage | null {
  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as { c?: number; e?: string[] };
    if (!parsed || !CAPACITY_TIERS.includes(parsed.c as Capacity)) return null;
    if (!Array.isArray(parsed.e)) return null;

    const entries: ShareableEntry[] = [];
    for (const row of parsed.e) {
      if (typeof row !== 'string') return null;
      const [carRef, slot, trimRef, nickname] = row.split('~');
      if (!carRef || slot === undefined) return null;
      const slotNumber = Number(slot);
      if (!Number.isInteger(slotNumber)) return null;
      const entry: ShareableEntry = { carRef, slot: slotNumber };
      if (trimRef) entry.trimRef = trimRef;
      if (nickname) entry.nickname = nickname;
      entries.push(entry);
    }
    return { capacity: parsed.c as Capacity, entries };
  } catch {
    return null;
  }
}

// --- File exports ---------------------------------------------------------

export interface BackupFile {
  kind: 'markey-garage-backup';
  version: number;
  exportedAt: string;
  /** Includes ownership. This file is for the visitor's own devices. */
  garage: Garage;
}

export interface ShareFile {
  kind: 'markey-garage-share';
  version: number;
  exportedAt: string;
  garage: ShareableGarage;
}

export function toBackupFile(garage: Garage, now = new Date().toISOString()): BackupFile {
  return {
    kind: 'markey-garage-backup',
    version: GARAGE_VERSION,
    exportedAt: now,
    garage,
  };
}

export function toShareFile(garage: Garage, now = new Date().toISOString()): ShareFile {
  return {
    kind: 'markey-garage-share',
    version: GARAGE_VERSION,
    exportedAt: now,
    garage: toShareable(garage),
  };
}

export type ImportResult =
  | { ok: true; garage: Garage; hadOwnership: boolean }
  | { ok: false; reason: string };

/**
 * Reads either export format back.
 *
 * The `kind` discriminator is what lets the UI tell the visitor which sort of
 * file they just opened — "this was a share, so it has no ownership details in
 * it" is information they need, not a detail to hide.
 */
export function fromExportedFile(value: unknown): ImportResult {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'That file is not a Markey garage export.' };
  }
  // Deliberately loose: `Partial<BackupFile & ShareFile>` collapses to `never`,
  // because the two `kind` literals cannot both hold. The point of this
  // function is to narrow an unknown file, so it starts unknown.
  const file = value as { kind?: unknown; garage?: unknown };

  if (file.kind === 'markey-garage-backup') {
    if (!isGarage(file.garage)) {
      return { ok: false, reason: "That backup file's contents could not be read." };
    }
    return {
      ok: true,
      garage: file.garage,
      hadOwnership: file.garage.entries.some((e) => e.ownership !== undefined),
    };
  }

  if (file.kind === 'markey-garage-share') {
    if (!isShareableGarage(file.garage)) {
      return { ok: false, reason: "That shared file's contents could not be read." };
    }
    return { ok: true, garage: fromShareable(file.garage), hadOwnership: false };
  }

  return { ok: false, reason: 'That file is not a Markey garage export.' };
}
