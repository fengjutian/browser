// happy-dom auto-fetches resources when it parses script/iframe/img tags.
// Tests should never hit the network; silence the resulting stderr noise
// while keeping tests deterministic.
if (typeof globalThis.fetch === 'function') {
  globalThis.fetch = (() => Promise.resolve(new Response())) as typeof fetch
}