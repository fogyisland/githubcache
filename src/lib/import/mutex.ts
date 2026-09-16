/**
 * M32.7.7-b — In-process mutex for cross-database apply.
 *
 * Two concurrent admin imports would race: both read the same source
 * pool, both try to insert, the row counts double. The mutex makes
 * the operation single-flight per process. It's intentionally
 * in-process (no Redis / external lock) — admin operations are
 * low-frequency and the recipient process is the only one that
 * matters; if the user has multiple admin sessions open, they get
 * the second one 422'd and have to retry.
 *
 * Promise-queue style: `acquire()` returns a Promise that resolves
 * when the lock is free; release is sync.
 */
export class ImportMutex {
  private locked = false;
  private waiters: Array<() => void> = [];

  acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the lock to the next waiter; keep `locked` true.
      next();
      return;
    }
    this.locked = false;
  }

  isLocked(): boolean {
    return this.locked;
  }
}

/** Singleton — one apply at a time across the whole process. */
export const importApplyMutex = new ImportMutex();