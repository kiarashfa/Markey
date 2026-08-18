<script lang="ts">
  /**
   * Guided Browse — SPEC.md §9.2.
   *
   * The **lower-commitment** of the two discovery tools: a step-by-step filter
   * that ends in a list. No scoring, no ranking, no percentages, no opinion
   * about which of the survivors is "best". That restraint is the feature —
   * Matchmaker (§9.3) is where ranking happens, and blurring the two would
   * leave the site with two tools that do the same thing slightly differently.
   *
   * Filtering runs through `applyDealbreakers` in `lib/math/matchmaker.ts`, the
   * same function Matchmaker uses, so the two can never disagree about what
   * passes.
   */
  import {
    applyDealbreakers,
    blockingConstraints,
    type Candidate,
    type Dealbreakers,
  } from '../../lib/math/matchmaker.ts';
  import type { CatalogueCar } from '../../lib/content/catalogue.ts';

  interface VocabTerm {
    id: string;
    label: string;
  }

  interface Props {
    cars: CatalogueCar[];
    bodyStyleTerms: VocabTerm[];
    powertrainTerms: VocabTerm[];
    drivetrainTerms: VocabTerm[];
  }

  let { cars, bodyStyleTerms, powertrainTerms, drivetrainTerms }: Props = $props();

  const candidates: Candidate[] = cars.map((car) => ({
    id: car.id,
    label: car.name,
    bodyStyles: car.bodyStyles,
    powertrains: car.powertrains,
    drivetrains: car.drivetrains,
    segment: car.segment ?? undefined,
    positioning: car.positioning ?? undefined,
    eras: car.eras,
    price: car.priceMin,
    seats: car.seatsMax,
    consumptionPer100km: car.consumptionMinL100km,
    zeroToHundredSeconds: car.zeroToHundredMinS,
    powerToWeightKwPerTonne:
      car.powerKwMax !== null && car.massMinKg ? car.powerKwMax / (car.massMinKg / 1000) : null,
    bootLitres: car.bootLitresMax,
    productionStart: car.yearStart,
    productionEnd: car.yearEnd,
  }));

  const STEPS = ['Body style', 'Powertrain', 'Drivetrain', 'Era', 'Results'] as const;
  let step = $state(0);

  let bodyStyles = $state<string[]>([]);
  let powertrains = $state<string[]>([]);
  let drivetrains = $state<string[]>([]);
  let producedAfter = $state<number | undefined>(undefined);

  const dealbreakers = $derived<Dealbreakers>({
    bodyStyles: bodyStyles.length ? bodyStyles : undefined,
    powertrains: powertrains.length ? powertrains : undefined,
    drivetrains: drivetrains.length ? drivetrains : undefined,
    producedAfter,
  });

  const outcomes = $derived(applyDealbreakers(candidates, dealbreakers));
  const survivors = $derived(outcomes.filter((o) => o.passed));
  const blocking = $derived(blockingConstraints(outcomes));

  const carsById = new Map(cars.map((c) => [c.id, c]));

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function reset() {
    bodyStyles = [];
    powertrains = [];
    drivetrains = [];
    producedAfter = undefined;
    step = 0;
  }

  const ERA_CHOICES = [
    { label: 'Any age', value: undefined },
    { label: '1990 or later', value: 1990 },
    { label: '2000 or later', value: 2000 },
    { label: '2010 or later', value: 2010 },
    { label: '2020 or later', value: 2020 },
  ];
</script>

<div class="flex flex-col gap-6">
  <!-- Progress. A step count is the whole reassurance a wizard offers. -->
  <ol class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    {#each STEPS as label, i (label)}
      <li class="flex items-center gap-2">
        {#if i > 0}<span aria-hidden="true" class="text-ink-muted">›</span>{/if}
        <button
          type="button"
          class="rounded px-2 py-1 transition-colors duration-150"
          class:font-semibold={i === step}
          style={i === step ? 'background-color: var(--color-surface-3);' : ''}
          onclick={() => (step = i)}
          aria-current={i === step ? 'step' : undefined}
        >
          {label}
        </button>
      </li>
    {/each}
  </ol>

  <div class="rounded-lg border border-line bg-surface-1 p-5">
    {#if step === 0}
      <fieldset>
        <legend class="type-heading text-base">What shape of car?</legend>
        <p class="mt-1 text-sm text-ink-secondary">
          Choose any number, or none to leave it open.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          {#each bodyStyleTerms as term (term.id)}
            <button
              type="button"
              class="pressable rounded-full border px-3 py-1.5 text-sm transition-colors duration-150"
              class:border-line-strong={bodyStyles.includes(term.id)}
              class:border-line={!bodyStyles.includes(term.id)}
              style={bodyStyles.includes(term.id) ? 'background-color: var(--color-surface-3);' : ''}
              aria-pressed={bodyStyles.includes(term.id)}
              onclick={() => (bodyStyles = toggle(bodyStyles, term.id))}
            >
              {term.label}
            </button>
          {/each}
        </div>
      </fieldset>
    {:else if step === 1}
      <fieldset>
        <legend class="type-heading text-base">How should it be powered?</legend>
        <div class="mt-4 flex flex-wrap gap-2">
          {#each powertrainTerms as term (term.id)}
            <button
              type="button"
              class="pressable rounded-full border px-3 py-1.5 text-sm transition-colors duration-150"
              class:border-line-strong={powertrains.includes(term.id)}
              class:border-line={!powertrains.includes(term.id)}
              style={powertrains.includes(term.id) ? 'background-color: var(--color-surface-3);' : ''}
              aria-pressed={powertrains.includes(term.id)}
              onclick={() => (powertrains = toggle(powertrains, term.id))}
            >
              {term.label}
            </button>
          {/each}
        </div>
      </fieldset>
    {:else if step === 2}
      <fieldset>
        <legend class="type-heading text-base">Which wheels driven?</legend>
        <div class="mt-4 flex flex-wrap gap-2">
          {#each drivetrainTerms as term (term.id)}
            <button
              type="button"
              class="pressable rounded-full border px-3 py-1.5 text-sm transition-colors duration-150"
              class:border-line-strong={drivetrains.includes(term.id)}
              class:border-line={!drivetrains.includes(term.id)}
              style={drivetrains.includes(term.id) ? 'background-color: var(--color-surface-3);' : ''}
              aria-pressed={drivetrains.includes(term.id)}
              onclick={() => (drivetrains = toggle(drivetrains, term.id))}
            >
              {term.label}
            </button>
          {/each}
        </div>
      </fieldset>
    {:else if step === 3}
      <fieldset>
        <legend class="type-heading text-base">How new?</legend>
        <div class="mt-4 flex flex-wrap gap-2">
          {#each ERA_CHOICES as choice (choice.label)}
            <button
              type="button"
              class="pressable rounded-full border px-3 py-1.5 text-sm transition-colors duration-150"
              class:border-line-strong={producedAfter === choice.value}
              class:border-line={producedAfter !== choice.value}
              style={producedAfter === choice.value ? 'background-color: var(--color-surface-3);' : ''}
              aria-pressed={producedAfter === choice.value}
              onclick={() => (producedAfter = choice.value)}
            >
              {choice.label}
            </button>
          {/each}
        </div>
      </fieldset>
    {:else}
      <div>
        <h2 class="type-heading text-base">
          {survivors.length}
          {survivors.length === 1 ? 'car matches' : 'cars match'}
        </h2>
        <p class="mt-1 text-sm text-ink-secondary">
          No ranking here — these all meet what you asked for equally. Use
          Matchmaker if you want them ordered by preference.
        </p>

        {#if survivors.length === 0}
          <div class="mt-4 rounded-lg border border-line bg-surface-2 p-4">
            <p class="text-sm">Nothing meets all of those conditions.</p>
            {#if blocking.length > 0}
              <p class="mt-2 text-sm text-ink-secondary">
                The condition ruling out the most cars on its own is
                <strong class="text-ink">{blocking[0]!.constraint}</strong> —
                relaxing it would bring back {blocking[0]!.blocks}
                {blocking[0]!.blocks === 1 ? 'car' : 'cars'}.
              </p>
            {/if}
            <button
              type="button"
              class="pressable mt-3 rounded-md border border-line bg-surface-1 px-3 py-1.5 text-sm font-medium"
              onclick={reset}
            >
              Start again
            </button>
          </div>
        {:else}
          <ul class="mt-4 grid gap-2 sm:grid-cols-2">
            {#each survivors as outcome (outcome.candidate.id)}
              {@const car = carsById.get(outcome.candidate.id)!}
              <li class="min-w-0">
                <a
                  href={car.url}
                  class="pressable flex min-w-0 items-center gap-3 rounded-lg border border-line bg-surface-2 p-3 transition-colors duration-150 hover:border-line-strong"
                >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">{car.name}</span>
                    <span class="block truncate text-xs text-ink-muted">
                      {car.brandName} · {car.yearStart}–{car.yearEnd ?? 'present'}
                    </span>
                  </span>
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <div class="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
      <button
        type="button"
        class="pressable rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        onclick={() => (step = Math.max(0, step - 1))}
        disabled={step === 0}
      >
        Back
      </button>

      <p class="text-xs text-ink-muted" aria-live="polite">
        {survivors.length} matching so far
      </p>

      <button
        type="button"
        class="pressable rounded-md border border-line-strong bg-surface-3 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        onclick={() => (step = Math.min(STEPS.length - 1, step + 1))}
        disabled={step === STEPS.length - 1}
      >
        Next
      </button>
    </div>
  </div>
</div>
