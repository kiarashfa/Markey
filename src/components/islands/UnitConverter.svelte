<script lang="ts">
  /**
   * Standalone unit converter.
   *
   * Every conversion routes through `lib/math/units.ts`, the same module the
   * spec tables use. That is the point of the shared math engine: this page
   * cannot tell you a different answer from a car page.
   *
   * Power converts to **PS by default**, with bhp shown alongside rather than
   * instead — the two differ by 1.4% and treating them as interchangeable is
   * the most common unit error in published car specs.
   */
  import {
    ccToCubicInches,
    kgToPounds,
    kmhToMph,
    kwToBhp,
    kwToPs,
    l100kmToMpgImp,
    l100kmToMpgUs,
    mmToFeetInches,
    mmToInches,
    nmToLbFt,
  } from '../../lib/math/units.ts';

  type Quantity = 'power' | 'torque' | 'mass' | 'length' | 'speed' | 'consumption' | 'displacement';

  let quantity = $state<Quantity>('power');
  let input = $state('150');

  const value = $derived(Number.parseFloat(input));
  const valid = $derived(Number.isFinite(value));

  const QUANTITIES: { id: Quantity; label: string; unit: string; placeholder: string }[] = [
    { id: 'power', label: 'Power', unit: 'kW', placeholder: '150' },
    { id: 'torque', label: 'Torque', unit: 'N⋅m', placeholder: '300' },
    { id: 'mass', label: 'Mass', unit: 'kg', placeholder: '1500' },
    { id: 'length', label: 'Length', unit: 'mm', placeholder: '4500' },
    { id: 'speed', label: 'Speed', unit: 'km/h', placeholder: '200' },
    { id: 'consumption', label: 'Consumption', unit: 'L/100 km', placeholder: '7.5' },
    { id: 'displacement', label: 'Displacement', unit: 'cc', placeholder: '2000' },
  ];

  const activeQuantity = $derived(QUANTITIES.find((q) => q.id === quantity)!);

  const fmt = (n: number, decimals = 1) =>
    n.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const results = $derived.by((): { label: string; value: string; note?: string }[] => {
    if (!valid) return [];
    switch (quantity) {
      case 'power':
        return [
          { label: 'Metric horsepower', value: `${fmt(kwToPs(value))} PS`, note: 'The DIN/PS figure most European and Japanese specs quote.' },
          { label: 'Mechanical horsepower', value: `${fmt(kwToBhp(value))} bhp`, note: 'The SAE figure. 1.4% smaller than PS for the same kW.' },
        ];
      case 'torque':
        return [{ label: 'Pound-feet', value: `${fmt(nmToLbFt(value))} lb⋅ft` }];
      case 'mass':
        return [{ label: 'Pounds', value: `${fmt(kgToPounds(value), 0)} lb` }];
      case 'length': {
        const { feet, inches } = mmToFeetInches(value);
        return [
          { label: 'Inches', value: `${fmt(mmToInches(value))} in` },
          { label: 'Feet and inches', value: `${feet}′ ${inches}″` },
        ];
      }
      case 'speed':
        return [{ label: 'Miles per hour', value: `${fmt(kmhToMph(value), 0)} mph` }];
      case 'consumption': {
        const us = l100kmToMpgUs(value);
        const imp = l100kmToMpgImp(value);
        return [
          { label: 'US miles per gallon', value: us === null ? '—' : `${fmt(us)} mpg` },
          { label: 'Imperial miles per gallon', value: imp === null ? '—' : `${fmt(imp)} mpg` },
          {
            label: 'Note',
            value: 'These are reciprocal scales',
            note: 'Halving L/100 km doubles mpg rather than halving it, so you cannot interpolate between them.',
          },
        ];
      }
      case 'displacement':
        return [{ label: 'Cubic inches', value: `${fmt(ccToCubicInches(value))} cu in` }];
    }
  });
</script>

<div class="flex flex-col gap-5">
  <div class="flex flex-wrap gap-1.5">
    {#each QUANTITIES as q (q.id)}
      <button
        type="button"
        class="pressable rounded-full border px-3 py-1.5 text-sm transition-colors duration-150"
        class:border-line-strong={quantity === q.id}
        class:border-line={quantity !== q.id}
        style={quantity === q.id ? 'background-color: var(--color-surface-3);' : ''}
        aria-pressed={quantity === q.id}
        onclick={() => {
          quantity = q.id;
          input = q.placeholder;
        }}
      >
        {q.label}
      </button>
    {/each}
  </div>

  <label class="block">
    <span class="text-sm text-ink-secondary">{activeQuantity.label} in {activeQuantity.unit}</span>
    <input
      type="number"
      bind:value={input}
      inputmode="decimal"
      class="type-data mt-1.5 w-full rounded-lg border border-line bg-surface-1 px-3.5 py-2.5 text-lg tabular-nums focus:border-line-strong focus:outline-none"
    />
  </label>

  {#if valid}
    <dl class="flex flex-col gap-3 rounded-lg border border-line bg-surface-1 p-4">
      {#each results as row (row.label)}
        <div class="border-b border-line pb-3 last:border-b-0 last:pb-0">
          <dt class="text-xs text-ink-muted">{row.label}</dt>
          <dd class="type-data mt-0.5 text-lg font-semibold tabular-nums">{row.value}</dd>
          {#if row.note}
            <p class="mt-1 max-w-readable text-xs leading-relaxed text-ink-muted">{row.note}</p>
          {/if}
        </div>
      {/each}
    </dl>
  {:else}
    <p class="rounded-lg border border-line bg-surface-1 p-4 text-sm text-ink-muted">
      Enter a number to convert.
    </p>
  {/if}
</div>
