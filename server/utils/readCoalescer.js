// Only in-flight work is shared: a later request always starts a fresh read.
// Authentication stays outside this helper and is validated on every request.
export function createReadCoalescer() {
  const owners = new Map();
  return {
    run(owner, variant, load) {
      const key = String(owner);
      let reads = owners.get(key);
      if (!reads) { reads = new Map(); owners.set(key, reads); }
      if (reads.has(variant)) return reads.get(variant);
      const current = () => owners.get(key) === reads && reads.get(variant) === promise;
      const promise = Promise.resolve().then(() => load(current)).finally(() => {
        if (!current()) return;
        reads.delete(variant);
        if (!reads.size) owners.delete(key);
      });
      reads.set(variant, promise);
      return promise;
    },
    invalidate(owner) { owners.delete(String(owner)); },
  };
}
