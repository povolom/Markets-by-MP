'use strict';
const form = document.querySelector('#holding-form');
const message = document.querySelector('#message');
let portfolio = null;
const currency = (value) => Number(value).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
async function request(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
function cell(row, value) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
async function refresh() {
  portfolio = await request('/api/portfolio');
  for (const key of ['value', 'cost', 'unrealized']) document.querySelector(`#${key}`).textContent = currency(portfolio[key]);
  const body = document.querySelector('#holdings'); body.replaceChildren();
  document.querySelector('#empty').hidden = portfolio.holdings.length > 0;
  for (const holding of portfolio.holdings) {
    const row = document.createElement('tr');
    for (const value of [holding.symbol, holding.shares, currency(holding.value), currency(holding.unrealized), `${holding.allocation}%`, holding.updated_at]) cell(row, value);
    const actions = document.createElement('td');
    const edit = document.createElement('button'); edit.textContent = 'Edit'; edit.className = 'secondary'; edit.setAttribute('aria-label', `Edit ${holding.symbol}`);
    edit.addEventListener('click', () => { for (const key of ['symbol', 'shares', 'average_cost', 'price']) form.elements[key].value = holding[key]; form.elements.symbol.focus(); });
    const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.className = 'secondary'; remove.setAttribute('aria-label', `Remove ${holding.symbol}`);
    remove.addEventListener('click', async () => {
      if (!confirm(`Remove ${holding.symbol} from this tracker?`)) return;
      try { await request('/api/remove', {symbol: holding.symbol}); await refresh(); message.textContent = `${holding.symbol} removed.`; }
      catch (error) { message.textContent = error.message; }
    });
    actions.append(edit, remove); row.append(actions); body.append(row);
  }
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = form.querySelector('[type=submit]'); submit.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try { await request('/api/holding', data); await refresh(); message.textContent = `${data.symbol.toUpperCase()} saved locally.`; }
  catch (error) { message.textContent = error.message; }
  finally { submit.disabled = false; }
});
document.querySelector('#export').addEventListener('click', () => {
  if (!portfolio) { message.textContent = 'Load the portfolio before exporting.'; return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify({exported_at: new Date().toISOString(), ...portfolio}, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'portfolio-cad.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
refresh().catch(error => { message.textContent = error.message; });
