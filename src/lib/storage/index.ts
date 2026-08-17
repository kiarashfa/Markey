/**
 * The one versioned `localStorage` wrapper — SPEC.md §9.8.
 *
 * Every feature that remembers anything goes through here: the theme choice,
 * My Garage, comparison persistence. Written once because the failure modes are
 * subtle and identical everywhere, and re-deriving them per feature is how a
 * site ends up with three different bugs in three different places.
 *
 * The four rules, all from SPEC.md §9.8:
 *
 *  1. **Namespaced and versioned keys.** `markey:garage:v1`, never `garage`.
 *     Nothing this site stores can collide with anything else on the origin,
 *     and a schema change is a new key rather than a landmine in an old one.
 *  2. **Schema-checked on read; an unrecognised blob is discarded whole.**
 *     Never partially parsed. Half-restoring a garage from a shape we no longer
 *     understand is worse than restoring nothing, because the visitor cannot
 *     tell which half is missing.
 *  3. **Every read and write wrapped.** Storage genuinely is not there in
 *     private browsing, under quota exhaustion, in an SSR pass, or when an
 *     enterprise policy disables it. None of those may throw into a component.
 *  4. **Failures surface honestly.** A write that did not happen returns a
 *     reason the UI can show. Nothing here fails silently — a garage that
 *     quietly forgets is the worst outcome of all.
 */

export const NAMESPACE = 'markey';

export type StorageFailure =
  | 'unavailable'
  | 'quota-exceeded'
  | 'not-found'
  | 'corrupt'
  | 'version-mismatch'
  | 'failed-validation';

export type ReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: StorageFailure; message: string };

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: StorageFailure; message: string };

/** Human-readable, and deliberately non-alarming where nothing is lost. */
export const FAILURE_MESSAGES: Record<StorageFailure, string> = {
  unavailable:
    "This browser isn't letting the site save anything — usually private browsing. Everything still works, but nothing will be here when you come back.",
  'quota-exceeded':
    "There's no room left to save. Removing a few entries, or clearing other site data, should free some up.",
  'not-found': 'Nothing saved yet.',
  corrupt:
    "What was saved couldn't be read, so it has been cleared rather than partially restored.",
  'version-mismatch':
    'What was saved came from an older version of this site and has been cleared rather than partially restored.',
  'failed-validation':
    "What was saved didn't match the expected shape, so it has been cleared rather than partially restored.",
};

export function storageKey(feature: string, version: number): string {
  return `${NAMESPACE}:${feature}:v${version}`;
}

/**
 * Whether storage can actually be written to.
 *
 * Feature-detection is not enough: Safari in private browsing exposes
 * `localStorage` and throws on write, so the only honest test is a real
 * round-trip.
 */
export function isStorageAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const probe = `${NAMESPACE}:__probe__`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

interface Envelope<T> {
  v: number;
  savedAt: string;
  data: T;
}

/**
 * Reads and validates a stored value.
 *
 * `validate` is mandatory rather than optional on purpose. An unvalidated read
 * is how a shape change from three releases ago becomes a runtime crash today,
 * and making the caller supply a guard means the check cannot be forgotten.
 */
export function read<T>(
  feature: string,
  version: number,
  validate: (value: unknown) => value is T,
): ReadResult<T> {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'unavailable', message: FAILURE_MESSAGES.unavailable };
  }

  const key = storageKey(feature, version);
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return { ok: false, reason: 'unavailable', message: FAILURE_MESSAGES.unavailable };
  }

  if (raw === null) {
    return { ok: false, reason: 'not-found', message: FAILURE_MESSAGES['not-found'] };
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    remove(feature, version);
    return { ok: false, reason: 'corrupt', message: FAILURE_MESSAGES.corrupt };
  }

  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    (envelope as Envelope<T>).v !== version
  ) {
    remove(feature, version);
    return {
      ok: false,
      reason: 'version-mismatch',
      message: FAILURE_MESSAGES['version-mismatch'],
    };
  }

  const data = (envelope as Envelope<T>).data;
  if (!validate(data)) {
    remove(feature, version);
    return {
      ok: false,
      reason: 'failed-validation',
      message: FAILURE_MESSAGES['failed-validation'],
    };
  }

  return { ok: true, data };
}

export function write<T>(feature: string, version: number, data: T): WriteResult {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'unavailable', message: FAILURE_MESSAGES.unavailable };
  }

  const envelope: Envelope<T> = { v: version, savedAt: new Date().toISOString(), data };

  try {
    window.localStorage.setItem(storageKey(feature, version), JSON.stringify(envelope));
    return { ok: true };
  } catch (error) {
    // QuotaExceededError is reported under several names across browsers, so
    // match on what is actually reliable rather than on one vendor's constant.
    const name = (error as { name?: string })?.name ?? '';
    const isQuota = /quota|QUOTA_EXCEEDED|NS_ERROR_DOM_QUOTA/i.test(name);
    const reason: StorageFailure = isQuota ? 'quota-exceeded' : 'unavailable';
    return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
  }
}

export function remove(feature: string, version: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(feature, version));
  } catch {
    // Nothing useful to do; the caller cannot act on a failed delete either.
  }
}

/** Every key this site owns — for a "clear everything" control. */
export function listOwnKeys(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return Object.keys(window.localStorage).filter((k) => k.startsWith(`${NAMESPACE}:`));
  } catch {
    return [];
  }
}

export function clearAll(): void {
  for (const key of listOwnKeys()) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* best effort */
    }
  }
}
