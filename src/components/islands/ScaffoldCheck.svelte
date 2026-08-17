<script lang="ts">
  /**
   * PHASE 0 SMOKE TEST — delete in Phase 2 when real islands arrive.
   * Its only job is to prove Svelte 5 runes hydrate correctly under the
   * `/Markey` base path. No product behaviour lives here.
   */
  let clicks = $state(0);
</script>

<button
  class="rounded-md border border-neutral-700 bg-neutral-800 px-4 py-2 font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
  onclick={() => clicks++}
>
  Svelte island hydrated — clicked {clicks}
  {clicks === 1 ? 'time' : 'times'}
</button>
