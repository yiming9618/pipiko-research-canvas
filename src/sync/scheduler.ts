// Decides WHEN to sync. Edits are batched: a sync starts only after the user
// has stopped for a few seconds, and never more often than once a minute.

export interface SchedulerOptions {
  run: () => Promise<void>
  /** Quiet time after the last edit before syncing. */
  idleMs?: number
  /** Minimum time between two sync rounds. */
  minGapMs?: number
  now?: () => number
}

export class SyncScheduler {
  private readonly run: () => Promise<void>
  private readonly idleMs: number
  private readonly minGapMs: number
  private readonly now: () => number
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private again = false
  private lastEnd = -Infinity

  constructor(opts: SchedulerOptions) {
    this.run = opts.run
    this.idleMs = opts.idleMs ?? 5_000
    this.minGapMs = opts.minGapMs ?? 60_000
    this.now = opts.now ?? Date.now
  }

  /** Something was edited on this device. */
  notifyChange(): void {
    this.schedule(this.idleMs)
  }

  /** The app was opened or came back to the foreground: check for changes from other devices. */
  requestSoon(): void {
    this.schedule(0)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.again = false
  }

  private schedule(delay: number): void {
    if (this.running) {
      this.again = true
      return
    }
    const earliest = this.lastEnd + this.minGapMs - this.now()
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.fire(), Math.max(delay, earliest, 0))
  }

  private async fire(): Promise<void> {
    this.timer = null
    this.running = true
    try {
      await this.run()
    } catch {
      // The caller's run() reports errors itself; the schedule just carries on.
    } finally {
      this.running = false
      this.lastEnd = this.now()
      if (this.again) {
        this.again = false
        this.schedule(this.idleMs)
      }
    }
  }
}
