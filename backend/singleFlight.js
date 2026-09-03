'use strict';

class SingleFlight {
  constructor() {
    this.inFlight = new Map();
  }

  run(key, workFactory) {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const work = Promise.resolve().then(workFactory);
    this.inFlight.set(key, work);

    return work.finally(() => {
      if (this.inFlight.get(key) === work) {
        this.inFlight.delete(key);
      }
    });
  }

  size() {
    return this.inFlight.size;
  }
}

module.exports = { SingleFlight };
