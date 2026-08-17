<script lang="ts">
  /**
   * My Garage — SPEC.md §9.4.
   *
   * **One feature, two purposes.** Collecting is the primary frame: the visitor
   * parks cars they like into numbered bays. Ownership is an *enhancement* on
   * top of any single bay, not a second product — ticking "I own this one"
   * unlocks tooling on that entry and nothing changes anywhere else.
   *
   * Everything stays in this browser. There is no account and no server to send
   * it to, so the only ways it leaves are the two the visitor chooses:
   *
   *  - **Share** — slots and cars only. The `ownership` block never travels.
   *  - **Full backup** — includes ownership, for the visitor's own devices.
   *
   * That distinction is stated *at the moment of sharing* (SPEC.md §9.4), not
   * buried on an about page, and it is enforced in `lib/garage/model.ts` by an
   * allowlist rather than by this component remembering to be careful.
   */
  import GarageSlot from './GarageSlot.svelte';
  import { read, write, isStorageAvailable } from '../../lib/storage/index.ts';
  import { depreciate, depreciationCurve } from '../../lib/math/depreciation.ts';
  import {
    CAPACITY_TIERS,
    GARAGE_FEATURE,
    GARAGE_VERSION,
    decodeShareLink,
    emptyGarage,
    encodeShareLink,
    fromExportedFile,
    fromShareable,
    isGarage,
    park,
    remove as removeEntry,
    setCapacity,
    setOwned,
    toBackupFile,
    toShareFile,
    updateEntry,
    updateOwnership,
    type Capacity,
    type Garage,
    type GarageEntry,
  } from '../../lib/garage/model.ts';
  import type { CatalogueCar } from '../../lib/content/catalogue.ts';

  let { cars }: { cars: CatalogueCar[] } = $props();

  const carsById = new Map(cars.map((c) => [c.id, c]));

  let garage = $state<Garage>(emptyGarage(10));
  let selectedUid = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let storageOk = $state(true);
  let picking = $state<number | null>(null);
  let shareLink = $state<string | null>(null);
  let importMessage = $state<string | null>(null);

  const selected = $derived(garage.entries.find((e) => e.uid === selectedUid) ?? null);
  const parkedCount = $derived(garage.entries.length);

  const bays = $derived(
    Array.from({ length: garage.capacity }, (_, slot) => {
      const entry = garage.entries.find((e) => e.slot === slot);
      if (!entry) return { slot, car: undefined };
      const car = carsById.get(entry.carRef);
      return {
        slot,
        car: {
          uid: entry.uid,
          name: car?.name ?? entry.carRef,
          brandName: car?.brandName ?? '',
          accentColor: car?.accentColor ?? 'var(--brand-accent)',
          heroSrc: car?.heroSrc ?? null,
          nickname: entry.nickname,
          owned: entry.ownership !== undefined,
          url: car?.url ?? '#',
        },
      };
    }),
  );

  function persist(next: Garage) {
    garage = next;
    const result = write(GARAGE_FEATURE, GARAGE_VERSION, next);
    // SPEC.md §9.8: never a silent failure. A garage that quietly forgets is
    // the worst possible outcome for a feature whose job is remembering.
    notice = result.ok ? null : result.message;
  }

  // --- actions -------------------------------------------------------------
  function parkCar(carRef: string, slot: number) {
    const result = park(garage, carRef, { slot });
    if (!result.ok) {
      notice = 'That garage is full. Free a bay or choose a larger garage.';
      return;
    }
    persist(result.garage);
    selectedUid = result.entry.uid;
    picking = null;
  }

  function unpark(uid: string) {
    persist(removeEntry(garage, uid));
    if (selectedUid === uid) selectedUid = null;
  }

  function changeCapacity(next: Capacity) {
    const { garage: resized, evicted } = setCapacity(garage, next);
    if (evicted.length > 0) {
      notice = `${evicted.length} car${evicted.length === 1 ? '' : 's'} sat beyond bay ${next} and ${evicted.length === 1 ? 'was' : 'were'} removed.`;
    }
    persist(resized);
  }

  function toggleOwned(uid: string, owned: boolean) {
    persist(setOwned(garage, uid, owned));
  }

  // --- exports -------------------------------------------------------------
  function download(filename: string, payload: unknown) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function makeShareLink() {
    const url = new URL(window.location.href);
    url.searchParams.set('g', encodeShareLink(garage));
    shareLink = url.toString();
  }

  async function copyShareLink() {
    if (!shareLink) makeShareLink();
    try {
      await navigator.clipboard.writeText(shareLink!);
      importMessage = 'Link copied.';
    } catch {
      importMessage = 'Could not copy automatically — select the link and copy it.';
    }
  }

  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const result = fromExportedFile(parsed);
      if (!result.ok) {
        importMessage = result.reason;
        return;
      }
      persist(result.garage);
      importMessage = result.hadOwnership
        ? 'Backup restored, including your ownership records.'
        : 'Shared garage loaded. Shares never carry ownership details, so none were included.';
    } catch {
      importMessage = 'That file could not be read.';
    } finally {
      input.value = '';
    }
  }

  // --- owned-car projections ----------------------------------------------
  const valueProjection = $derived.by(() => {
    if (!selected?.ownership?.purchasePrice || !selected.ownership.purchaseDate) return null;
    const purchased = new Date(selected.ownership.purchaseDate);
    if (Number.isNaN(purchased.getTime())) return null;
    const ageYears = (Date.now() - purchased.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (ageYears < 0) return null;

    const car = carsById.get(selected.carRef);
    const inputs = {
      purchasePrice: selected.ownership.purchasePrice,
      ageYears,
      positioning: car?.positioning ?? 'mainstream',
      mileageKm: selected.ownership.currentMileage,
    };
    const now = depreciate(inputs);
    if (!now) return null;

    const curve = depreciationCurve(
      { ...inputs, ageYears: 0 },
      Math.max(15, Math.ceil(ageYears) + 5),
      0.5,
    );
    const anchors = selected.ownership.valueAnchors;

    // Chart geometry is computed here rather than in the template: Svelte only
    // allows `{@const}` as the immediate child of a block, so an SVG cannot
    // declare its own scales inline.
    const maxValue = Math.max(...curve.map((p) => p.value), ...anchors.map((a) => a.value), 1);
    const maxAge = Math.max(...curve.map((p) => p.ageYears), 1);
    const px = (a: number) => 30 + (a / maxAge) * 560;
    const py = (v: number) => 8 + (1 - v / maxValue) * 118;

    return {
      now,
      ageYears,
      path: curve
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.ageYears).toFixed(1)},${py(p.value).toFixed(1)}`)
        .join(' '),
      nowPoint: { x: px(ageYears), y: py(now.value) },
      anchorPoints: anchors
        .map((anchor) => {
          const age =
            (new Date(anchor.date).getTime() - purchased.getTime()) /
            (365.25 * 24 * 3600 * 1000);
          return { date: anchor.date, age, x: px(age), y: py(anchor.value) };
        })
        .filter((p) => p.age >= 0 && p.age <= maxAge),
    };
  });

  /** Service reminders from mileage and date intervals. */
  const serviceDue = $derived.by(() => {
    const ownership = selected?.ownership;
    if (!ownership) return null;
    const last = ownership.serviceLog
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!last) return { reason: 'No service recorded yet.', overdue: false };

    const monthsSince = (Date.now() - new Date(last.date).getTime()) / (30.44 * 24 * 3600 * 1000);
    const kmSince =
      ownership.currentMileage !== undefined && last.mileage !== undefined
        ? ownership.currentMileage - last.mileage
        : null;

    const overdueByTime = monthsSince >= 12;
    const overdueByDistance = kmSince !== null && kmSince >= 15000;
    return {
      reason: [
        `Last service ${Math.floor(monthsSince)} month${Math.floor(monthsSince) === 1 ? '' : 's'} ago`,
        kmSince !== null ? `${kmSince.toLocaleString('en-GB')} km ago` : null,
      ]
        .filter(Boolean)
        .join(', ') + '.',
      overdue: overdueByTime || overdueByDistance,
    };
  });

  // --- lifecycle -----------------------------------------------------------
  $effect(() => {
    storageOk = isStorageAvailable();
    if (!storageOk) {
      notice =
        "This browser isn't letting the site save anything — usually private browsing. You can still build a garage and share or download it, but it won't be here when you come back.";
    }

    // A shared garage in the URL takes precedence over what is stored, but is
    // never written over it until the visitor chooses to keep it.
    const shared = new URLSearchParams(window.location.search).get('g');
    if (shared) {
      const decoded = decodeShareLink(shared);
      if (decoded) {
        garage = fromShareable(decoded);
        importMessage =
          "You're looking at a shared garage. Shares never include ownership details. Save it to make it yours.";
        return;
      }
      importMessage = 'That shared garage link could not be read.';
    }

    const stored = read(GARAGE_FEATURE, GARAGE_VERSION, isGarage);
    if (stored.ok) garage = stored.data;
    else if (stored.reason !== 'not-found' && stored.reason !== 'unavailable') {
      notice = stored.message;
    }
  });

  const money = (v: number) => Math.round(v).toLocaleString('en-GB');
</script>

<div class="flex flex-col gap-6">
  {#if notice}
    <p class="rounded-lg border border-status-estimated/40 bg-status-estimated/10 p-3 text-sm" role="status">
      {notice}
    </p>
  {/if}
  {#if importMessage}
    <p class="rounded-lg border border-line bg-surface-2 p-3 text-sm" role="status">
      {importMessage}
    </p>
  {/if}

  <!-- Capacity is a first-class visual, not a number in a corner. -->
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="type-data text-sm">
      <span class="text-lg font-semibold tabular-nums">{parkedCount}</span>
      <span class="text-ink-muted"> / {garage.capacity} bays filled</span>
    </p>

    <div class="flex items-center gap-2">
      <span class="text-xs text-ink-muted">Garage size</span>
      <div class="flex items-center gap-0.5 rounded-full border border-line bg-surface-1 p-0.5">
        {#each CAPACITY_TIERS as tier (tier)}
          <button
            type="button"
            class="pressable rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150"
            style={garage.capacity === tier ? 'background-color: var(--color-surface-3);' : ''}
            aria-pressed={garage.capacity === tier}
            onclick={() => changeCapacity(tier)}
          >
            {tier}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <!-- The bays -->
  <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    {#each bays as bay (bay.slot)}
      <li class="min-w-0">
        <GarageSlot
          slot={bay.slot}
          car={bay.car}
          selected={bay.car ? bay.car.uid === selectedUid : picking === bay.slot}
          onSelect={() => {
            if (bay.car) selectedUid = bay.car.uid === selectedUid ? null : bay.car.uid;
            else picking = picking === bay.slot ? null : bay.slot;
          }}
        />
      </li>
    {/each}
  </ul>

  {#if picking !== null}
    <fieldset class="rounded-lg border border-line bg-surface-1 p-4">
      <legend class="px-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
        Park a car in bay {picking + 1}
      </legend>
      {#if cars.length === 0}
        <p class="mt-2 text-sm text-ink-muted">There are no cars in the catalog yet.</p>
      {:else}
        <ul class="mt-2 grid gap-1 sm:grid-cols-2">
          {#each cars as car (car.id)}
            <li>
              <button
                type="button"
                class="pressable flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-surface-2"
                onclick={() => parkCar(car.id, picking!)}
              >
                <span class="min-w-0 flex-1 truncate">
                  {car.name}<span class="text-ink-muted"> · {car.brandName}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </fieldset>
  {/if}

  <!-- Detail panel for the selected bay -->
  {#if selected}
    {@const car = carsById.get(selected.carRef)}
    <section class="rounded-lg border border-line bg-surface-1 p-5" style={`--brand-accent: ${car?.accentColor ?? 'currentColor'};`}>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="type-heading text-lg">
            <a class="hover:underline" href={car?.url ?? '#'}>{car?.name ?? selected.carRef}</a>
          </h2>
          <p class="mt-0.5 text-sm text-ink-muted">
            Bay {selected.slot + 1}{car ? ` · ${car.brandName}` : ''}
          </p>
        </div>
        <button
          type="button"
          class="pressable rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm"
          onclick={() => unpark(selected.uid)}
        >
          Remove from garage
        </button>
      </div>

      <label class="mt-4 block">
        <span class="text-sm text-ink-secondary">Nickname</span>
        <input
          type="text"
          value={selected.nickname ?? ''}
          placeholder="optional"
          oninput={(e) =>
            persist(updateEntry(garage, selected.uid, { nickname: (e.currentTarget as HTMLInputElement).value || undefined }))}
          class="mt-1.5 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm focus:border-line-strong focus:outline-none"
        />
      </label>

      <label class="mt-4 flex items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={selected.ownership !== undefined}
          onchange={(e) => toggleOwned(selected.uid, (e.currentTarget as HTMLInputElement).checked)}
          class="size-4"
        />
        <span class="font-medium">I own this car</span>
      </label>

      {#if selected.ownership}
        {@const ownership = selected.ownership}
        <div class="mt-4 border-t border-line pt-4">
          <p class="text-xs leading-relaxed text-ink-muted">
            These details stay on this device. They are included in a full
            backup, and never in a share.
          </p>

          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <label class="block">
              <span class="text-xs text-ink-secondary">Purchase date</span>
              <input
                type="date"
                value={ownership.purchaseDate ?? ''}
                oninput={(e) => persist(updateOwnership(garage, selected.uid, { purchaseDate: (e.currentTarget as HTMLInputElement).value || undefined }))}
                class="mt-1 w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm focus:border-line-strong focus:outline-none"
              />
            </label>
            <label class="block">
              <span class="text-xs text-ink-secondary">Purchase price</span>
              <input
                type="number"
                value={ownership.purchasePrice ?? ''}
                oninput={(e) => persist(updateOwnership(garage, selected.uid, { purchasePrice: Number((e.currentTarget as HTMLInputElement).value) || undefined }))}
                class="type-data mt-1 w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm tabular-nums focus:border-line-strong focus:outline-none"
              />
            </label>
            <label class="block">
              <span class="text-xs text-ink-secondary">Current mileage, km</span>
              <input
                type="number"
                value={ownership.currentMileage ?? ''}
                oninput={(e) => persist(updateOwnership(garage, selected.uid, { currentMileage: Number((e.currentTarget as HTMLInputElement).value) || undefined }))}
                class="type-data mt-1 w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm tabular-nums focus:border-line-strong focus:outline-none"
              />
            </label>
            <label class="block">
              <span class="text-xs text-ink-secondary">Registration</span>
              <input
                type="text"
                value={ownership.plate ?? ''}
                oninput={(e) => persist(updateOwnership(garage, selected.uid, { plate: (e.currentTarget as HTMLInputElement).value || undefined }))}
                class="mt-1 w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm focus:border-line-strong focus:outline-none"
              />
            </label>
          </div>

          {#if serviceDue}
            <p
              class="mt-4 rounded-md border px-3 py-2 text-sm"
              class:border-status-estimated={serviceDue.overdue}
              class:border-line={!serviceDue.overdue}
            >
              <span class="font-medium">{serviceDue.overdue ? 'Service likely due.' : 'Service.'}</span>
              <span class="text-ink-secondary"> {serviceDue.reason}</span>
            </p>
          {/if}

          {#if valueProjection}
            <div class="mt-4">
              <p class="text-sm">
                <span class="text-ink-secondary">Projected value now</span>
                <span class="type-data ml-2 text-lg font-semibold tabular-nums">
                  {money(valueProjection.now.value)}
                </span>
              </p>
              <svg viewBox="0 0 600 140" class="mt-2 w-full" role="img" aria-label={`Projected value falling from ${money(valueProjection.now.value)} today.`}>
                <path d={valueProjection.path} fill="none" stroke="var(--brand-accent)" stroke-width="2" />
                {#each valueProjection.anchorPoints as anchor (anchor.date)}
                  <circle cx={anchor.x} cy={anchor.y} r="4" fill="var(--color-status-verified)" />
                {/each}
                <circle cx={valueProjection.nowPoint.x} cy={valueProjection.nowPoint.y} r="4" fill="var(--brand-accent)" />
              </svg>
              <p class="mt-1 text-xs leading-relaxed text-ink-muted">
                The line is the projection from the published formula; the green
                dots are real valuations you logged. The curve is deliberately
                not refitted to them — where they diverge is the interesting
                part, and hiding that would throw away the only real market data
                this site ever sees.
              </p>
            </div>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  <!-- Sharing. The distinction is stated here, at the moment of sharing. -->
  <section class="rounded-lg border border-line bg-surface-1 p-5">
    <h2 class="type-heading text-base">Take it with you</h2>

    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <div class="rounded-lg border border-line bg-surface-2 p-4">
        <h3 class="text-sm font-semibold">Share</h3>
        <p class="mt-1 text-xs leading-relaxed text-ink-muted">
          A link or file with <strong class="text-ink-secondary">only which cars are in which bays</strong>.
          No mileage, no purchase price, no registration, no service history —
          a shared garage is a top-ten list, not a personal record.
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="pressable rounded-md border border-line bg-surface-1 px-3 py-1.5 text-sm font-medium" onclick={copyShareLink}>
            Copy link
          </button>
          <button type="button" class="pressable rounded-md border border-line bg-surface-1 px-3 py-1.5 text-sm font-medium" onclick={() => download('markey-garage-share.json', toShareFile(garage))}>
            Download share file
          </button>
        </div>
        {#if shareLink}
          <label class="mt-3 block">
            <span class="sr-only">Share link</span>
            <input readonly value={shareLink} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} class="w-full rounded border border-line bg-surface-1 px-2 py-1 text-xs" />
          </label>
        {/if}
      </div>

      <div class="rounded-lg border border-line bg-surface-2 p-4">
        <h3 class="text-sm font-semibold">Full backup</h3>
        <p class="mt-1 text-xs leading-relaxed text-ink-muted">
          A file that <strong class="text-ink-secondary">does include your ownership details</strong>,
          for moving to another of your own devices. Do not post this one.
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="pressable rounded-md border border-line bg-surface-1 px-3 py-1.5 text-sm font-medium" onclick={() => download('markey-garage-backup.json', toBackupFile(garage))}>
            Download backup
          </button>
          <label class="pressable cursor-pointer rounded-md border border-line bg-surface-1 px-3 py-1.5 text-sm font-medium">
            Restore from file
            <input type="file" accept="application/json,.json" class="sr-only" onchange={importFile} />
          </label>
        </div>
      </div>
    </div>
  </section>
</div>
