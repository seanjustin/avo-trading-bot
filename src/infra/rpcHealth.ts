import { Config } from '../config';
import { RiskEngine } from '../risk/engine';
import { getLogger } from '../telemetry/logger';

export type SlotChecker = () => Promise<number>;

export interface RpcStatus {
  healthy:      boolean;
  failureCount: number;
  avgLatencyMs: number;
}

export class RpcHealthMonitor {
  private failureCount  = 0;
  private latencyEmaMs  = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config:  Config,
    private readonly risk:    RiskEngine,
    private readonly getSlot: SlotChecker,
  ) {}

  start(intervalMs = 15_000): void {
    void this.probe();
    this.timer = setInterval(() => void this.probe(), intervalMs);
    getLogger().info({ intervalMs, service: 'rpc-health' }, 'RPC health monitor started');
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async probe(): Promise<void> {
    const start = Date.now();
    try {
      await this.getSlot();
      this.onSuccess(Date.now() - start);
    } catch (err) {
      this.onFailure(err as Error);
    }
  }

  getStatus(): RpcStatus {
    return {
      healthy:      this.failureCount === 0,
      failureCount: this.failureCount,
      avgLatencyMs: this.latencyEmaMs,
    };
  }

  private onSuccess(latencyMs: number): void {
    this.failureCount  = 0;
    this.latencyEmaMs  = this.latencyEmaMs === 0
      ? latencyMs
      : this.latencyEmaMs * 0.9 + latencyMs * 0.1;
    getLogger().debug(
      { latencyMs, avgLatencyMs: Math.round(this.latencyEmaMs), service: 'rpc-health' },
      'RPC probe OK',
    );
  }

  private onFailure(err: Error): void {
    this.failureCount++;
    getLogger().warn(
      { failureCount: this.failureCount, err: err.message, service: 'rpc-health' },
      'RPC probe failed',
    );
    if (
      this.failureCount >= this.config.MAX_RPC_FAILURES &&
      this.config.KILL_SWITCH_ON_RPC_INSTABILITY
    ) {
      this.risk.triggerKillSwitch(
        `RPC unstable: ${this.failureCount} consecutive failures >= MAX_RPC_FAILURES=${this.config.MAX_RPC_FAILURES}`,
      );
    }
  }
}
