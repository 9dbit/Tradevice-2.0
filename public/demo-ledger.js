(() => {
  const section = document.createElement('section');
  section.style.cssText = 'max-width:1440px;margin:20px auto;padding:22px;border:1px solid #254234;border-radius:16px;background:#0c1711;color:#e6f0e9;font-family:system-ui;';
  const heading = document.createElement('h2'); heading.textContent = 'MT5 Demo Orders'; heading.style.margin = '0 0 8px';
  const status = document.createElement('p');
  const download = document.createElement('a'); download.href = '/downloads/TradeviceDemoExecutor.mq5'; download.textContent = 'Download Demo Executor'; download.style.color = '#53f28f';
  const container = document.createElement('div'); container.style.overflowX = 'auto';
  section.append(heading, status, download, container); document.body.append(section);
  const fields = ['Status', 'Type', 'Entry', 'SL', 'TP', 'Lot', 'MT5 Ticket', 'Result $', 'Cancellation reason'];
  const display = value => value == null ? '—' : String(value);
  const price = value => Number.isFinite(Number(value)) ? Number(value).toFixed(3) : '—';
  let busy = false;
  async function refresh() {
    if (busy) return; busy = true;
    try {
      const response = await fetch('/api/v1/demo/ledger', { cache: 'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      status.textContent = data.enabled ? 'Demo enabled · confidence >80% + valid pending setup · real accounts blocked' : 'Demo disabled · waiting for server configuration and MT5 installation · real accounts blocked';
      const table = document.createElement('table'); table.style.cssText = 'width:100%;border-collapse:collapse;margin-top:16px;text-align:left;font-variant-numeric:tabular-nums';
      const head = table.createTHead().insertRow();
      fields.forEach(label => { const th = document.createElement('th'); th.textContent = label; th.style.padding = '10px'; head.append(th); });
      const body = table.createTBody();
      for (const order of data.orders || []) {
        const row = body.insertRow(); const p = order.plan;
        [order.status, p.order_type, price(p.entry), price(p.stop_loss), price(p.take_profit), p.lot, order.ticket, order.result?.pnl_usd, order.cancel_reason].forEach(value => {
          const cell = row.insertCell(); cell.textContent = display(value); cell.style.cssText = 'padding:12px 10px;border-top:1px solid #254234;white-space:nowrap';
        });
      }
      if (!data.orders?.length) { const cell = body.insertRow().insertCell(); cell.colSpan = fields.length; cell.textContent = 'No demo order has been dispatched.'; cell.style.padding = '18px 10px'; }
      container.replaceChildren(table);
    } catch { status.textContent = 'Demo status unavailable. Last displayed records may be stale.'; }
    finally { busy = false; }
  }
  refresh(); setInterval(refresh, 5000);
})();
