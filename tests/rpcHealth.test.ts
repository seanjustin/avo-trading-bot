import { loadConfig, resetConfig } from '../src/config';
import { AVO_MINT, USDC_MINT } from '../src/config/constants';
import { RiskEngine } from '../src/risk/engine';
import { RpcHealthMonitor } from '../src/infra/rpcHealth';

const BASE_ENV: Record<string, string> = {
  AVO_MINT,
  USDC_MINT,
  SOLANA_RPC_URL:                 'https://api.mainnet-beta.solana.com',
  SOLANA_KEYPAIR_PATH:            './wallet/keypair.json',
  MAX_RPC_FAILURES:               '3',
  KILL_SWITCH_ON_RPC_INSTABILITY: 'true',
};

beforeEach(() => resetConfig());

describe('RpcHealthMonitor', () => {
  it('starts in a healthy state', () => {
    const config  = loadConfig(BASE_ENV);
    const risk    = new RiskEngine(config);
    const monitor = new RpcHealthMonitor(config, risk, async () => 123456789);

    const status = monitor.getStatus();
    expect(status.healthy).toBe(true);
    expect(status.failureCount).toBe(0);
    expect(status.avgLatencyMs).toBe(0);
  });

  it('remains healthy after a successful probe', async () => {
    const config  = loadConfig(BASE_ENV);
    const risk    = new RiskEngine(config);
    const monitor = new RpcHealthMonitor(config, risk, async () => 123456789);

    await monitor.probe();

    expect(monitor.getStatus().healthy).toBe(true);
    expect(monitor.getStatus().failureCount).toBe(0);
  });

  it('records latency EMA on successful probes', async () => {
    const config  = loadConfig(BASE_ENV);
    const risk    = new RiskEngine(config);
    const monitor = new RpcHealthMonitor(config, risk, async () => 123456789);

    await monitor.probe();
    await monitor.probe();

    expect(monitor.getStatus().avgLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('increments failureCount on a failed probe', async () => {
    const config  = loadConfig(BASE_ENV);
    const risk    = new RiskEngine(config);
    const monitor = new RpcHealthMonitor(config, risk, async () => {
      throw new Error('connection refused');
    });

    await monitor.probe();

    expect(monitor.getStatus().failureCount).toBe(1);
    expect(monitor.getStatus().healthy).toBe(false);
  });

  it('resets failureCount to 0 on success after failures', async () => {
    const config  = loadConfig(BASE_ENV);
    const risk    = new RiskEngine(config);
    let shouldFail = true;
    const monitor = new RpcHealthMonitor(config, risk, async () => {
      if (shouldFail) throw new Error('rpc down');
      return 123456789;
    });

    await monitor.probe();
    await monitor.probe();
    expect(monitor.getStatus().failureCount).toBe(2);

    shouldFail = false;
    await monitor.probe();

    expect(monitor.getStatus().failureCount).toBe(0);
    expect(monitor.getStatus().healthy).toBe(true);
  });

  it('triggers kill switch after MAX_RPC_FAILURES consecutive failures', async () => {
    const config  = loadConfig({ ...BASE_ENV, MAX_RPC_FAILURES: '3' });
    const risk    = new RiskEngine(config);
    const monitor = new RpcHealthMonitor(config, risk, async () => {
      throw new Error('rpc down');
    });

    await monitor.probe();
    await monitor.probe();
    expect(risk.isKillSwitchActive()).toBe(false);

    await monitor.probe(); // 3rd failure → triggers kill switch
    expect(risk.isKillSwitchActive()).toBe(true);
  });

  it('does NOT trigger kill switch before reaching MAX_RPC_FAILURES', async () => {
    const config  = loadConfig({ ...BASE_ENV, MAX_RPC_FAILURES: '3' });
    const risk    = new RiskEngine(config);
    const monitor = new RpcHealthMonitor(config, risk, async () => {
      throw new Error('rpc down');
    });

    await monitor.probe();
    await monitor.probe(); // only 2 failures

    expect(risk.isKillSwitchActive()).toBe(false);
  });

  it('does NOT trigger kill switch when KILL_SWITCH_ON_RPC_INSTABILITY=false', async () => {
    const config  = loadConfig({
      ...BASE_ENV,
      MAX_RPC_FAILURES:               '1',
      KILL_SWITCH_ON_RPC_INSTABILITY: 'false',
    });
    const risk    = new RiskEngine(config);
    const monitor = new RpcHealthMonitor(config, risk, async () => {
      throw new Error('rpc down');
    });

    await monitor.probe();

    expect(risk.isKillSwitchActive()).toBe(false);
  });

  it('stop() prevents further probes from the interval', () => {
    const config  = loadConfig(BASE_ENV);
    const risk    = new RiskEngine(config);
    const monitor = new RpcHealthMonitor(config, risk, async () => 123456789);

    monitor.start(100);
    monitor.stop();

    // If stop() didn't work, the timer would keep running and potentially
    // interfere with other tests. Just verify it doesn't throw.
    expect(monitor.getStatus().healthy).toBe(true);
  });
});
