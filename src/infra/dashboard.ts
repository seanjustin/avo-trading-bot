import * as http from 'http';
import { Config } from '../config';
import { RiskEngine } from '../risk/engine';
import { PaperLedger } from '../execution/paperLedger';
import { RpcHealthMonitor } from './rpcHealth';
import { AvoRouteMonitor } from '../strategy/avoRouteMonitor';
import { getLogger } from '../telemetry/logger';

export interface DashboardDeps {
  config:   Config;
  risk:     RiskEngine;
  ledger:   PaperLedger;
  rpcMon:   RpcHealthMonitor;
  strategy: AvoRouteMonitor;
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AVO Trading Bot</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d1117;color:#e6edf3;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;padding:24px}
  h1{font-size:1.6rem;font-weight:700;letter-spacing:-.5px;margin-bottom:4px}
  .sub{color:#8b949e;font-size:.85rem;margin-bottom:28px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-bottom:28px}
  .card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:20px}
  .card-label{color:#8b949e;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
  .card-value{font-size:1.7rem;font-weight:700;line-height:1}
  .card-sub{color:#8b949e;font-size:.8rem;margin-top:6px}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.75rem;font-weight:600;letter-spacing:.04em}
  .green{background:#1a4731;color:#3fb950}
  .red{background:#4d1c1c;color:#f85149}
  .yellow{background:#3d2c00;color:#d29922}
  .blue{background:#0d2149;color:#58a6ff}
  .fills{background:#161b22;border:1px solid #30363d;border-radius:10px;overflow:hidden}
  .fills h2{padding:16px 20px;font-size:.95rem;border-bottom:1px solid #30363d;color:#8b949e;font-weight:600;text-transform:uppercase;letter-spacing:.08em}
  table{width:100%;border-collapse:collapse}
  th{padding:10px 20px;text-align:left;font-size:.75rem;color:#8b949e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #21262d}
  td{padding:12px 20px;font-size:.85rem;border-bottom:1px solid #21262d}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#1c2128}
  .pill{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.72rem;font-weight:600}
  .ts{color:#6e7681;font-size:.75rem}
  #updated{color:#6e7681;font-size:.8rem;margin-top:20px;text-align:right}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
  .dot-green{background:#3fb950}
  .dot-red{background:#f85149}
  .dot-pulse{animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
</style>
</head>
<body>
<h1>AVO Trading Bot</h1>
<div class="sub" id="mode-line">Loading…</div>

<div class="grid" id="cards">
  <div class="card"><div class="card-label">Kill Switch</div><div class="card-value" id="kill">—</div></div>
  <div class="card"><div class="card-label">RPC Health</div><div class="card-value" id="rpc">—</div><div class="card-sub" id="rpc-sub"></div></div>
  <div class="card"><div class="card-label">Paper Fills</div><div class="card-value" id="fills-count">—</div></div>
  <div class="card"><div class="card-label">Total Output</div><div class="card-value" id="output">—</div><div class="card-sub">USDC received</div></div>
  <div class="card"><div class="card-label">Daily Loss</div><div class="card-value" id="daily-loss">—</div><div class="card-sub" id="daily-limit"></div></div>
  <div class="card"><div class="card-label">Consec. Losses</div><div class="card-value" id="consec">—</div><div class="card-sub" id="consec-limit"></div></div>
</div>

<div class="fills">
  <h2>Recent Fills</h2>
  <table>
    <thead><tr><th>#</th><th>Venue</th><th>Output USDC</th><th>Price</th><th>Fee (bps)</th><th>Time</th></tr></thead>
    <tbody id="fills-body"><tr><td colspan="6" style="color:#8b949e;text-align:center;padding:30px">Loading…</td></tr></tbody>
  </table>
</div>

<div id="updated"></div>

<script>
async function refresh() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();

    document.getElementById('mode-line').innerHTML =
      '<span class="badge ' + (d.mode === 'LIVE' ? 'red' : 'blue') + '">' + d.mode + '</span>' +
      '&nbsp;&nbsp;scanning every ' + (d.scanIntervalMs / 1000).toFixed(0) + 's';

    const ks = d.killSwitch;
    document.getElementById('kill').innerHTML =
      '<span class="dot dot-' + (ks ? 'red' : 'green') + (ks ? ' dot-pulse' : '') + '"></span>' +
      (ks ? '<span style="color:#f85149">ACTIVE</span>' : '<span style="color:#3fb950">OFF</span>');

    const rh = d.rpc;
    document.getElementById('rpc').innerHTML =
      '<span class="badge ' + (rh.healthy ? 'green' : 'red') + '">' +
      (rh.healthy ? 'Healthy' : 'Degraded') + '</span>';
    document.getElementById('rpc-sub').textContent =
      rh.avgLatencyMs > 0 ? rh.avgLatencyMs.toFixed(0) + ' ms avg · ' + rh.failureCount + ' failures' : 'No probes yet';

    document.getElementById('fills-count').textContent = d.ledger.totalFills;
    document.getElementById('output').textContent = d.ledger.totalOutputUsdc.toFixed(2);
    document.getElementById('daily-loss').innerHTML =
      '<span style="color:' + (d.dailyLossUsdc > 0 ? '#f85149' : '#3fb950') + '">' +
      d.dailyLossUsdc.toFixed(2) + '</span>';
    document.getElementById('daily-limit').textContent = 'limit ' + d.maxDailyLossUsdc + ' USDC';
    document.getElementById('consec').textContent = d.consecutiveLosses;
    document.getElementById('consec-limit').textContent = 'limit ' + d.maxConsecutiveLosses;

    const fills = d.fills.slice().reverse();
    const tbody = document.getElementById('fills-body');
    if (fills.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#8b949e;text-align:center;padding:30px">No fills yet — bot is running in paper mode</td></tr>';
    } else {
      tbody.innerHTML = fills.slice(0, 20).map(f => {
        const t = new Date(f.filledAt).toLocaleTimeString();
        return '<tr>' +
          '<td class="ts">' + f.fillId + '</td>' +
          '<td><span class="pill ' + (f.venue === 'jupiter' ? 'green' : 'blue') + '">' + f.venue + '</span></td>' +
          '<td><strong>' + f.outputUsdc.toFixed(4) + '</strong></td>' +
          '<td>' + f.effectivePrice.toFixed(6) + '</td>' +
          '<td>' + f.estimatedFeesBps + '</td>' +
          '<td class="ts">' + t + '</td>' +
          '</tr>';
      }).join('');
    }

    document.getElementById('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch(e) {
    document.getElementById('updated').textContent = 'Connection error — retrying…';
  }
}

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;

export function startDashboard(port: number, deps: DashboardDeps): http.Server {
  const { config, risk, ledger, rpcMon, strategy } = deps;

  const server = http.createServer((req, res) => {
    if (req.url === '/api/status') {
      const summary = ledger.getSummary();
      const rpc     = rpcMon.getStatus();
      const payload = {
        mode:                config.PAPER_TRADING ? 'PAPER' : 'LIVE',
        scanIntervalMs:      config.SCAN_INTERVAL_MS,
        killSwitch:          risk.isKillSwitchActive(),
        rpc,
        ledger: {
          totalFills:      summary.totalFills,
          totalOutputUsdc: summary.totalOutputUsdc,
        },
        fills:               ledger.getFills(),
        dailyLossUsdc:       risk.getDailyLoss(),
        maxDailyLossUsdc:    config.MAX_DAILY_LOSS_USDC,
        consecutiveLosses:   strategy.getConsecutiveLosses(),
        maxConsecutiveLosses: config.MAX_CONSECUTIVE_LOSSES,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  });

  server.listen(port, () => {
    getLogger().info({ port, service: 'dashboard' }, `Dashboard live → http://localhost:${port}`);
  });

  return server;
}
