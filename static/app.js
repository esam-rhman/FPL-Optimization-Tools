/* ── Tab navigation ─────────────────────────────────────────── */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');

    if (btn.dataset.tab === 'data') loadFileStatus();
    if (btn.dataset.tab === 'results') loadResultFiles();
  });
});

/* ── Settings ───────────────────────────────────────────────── */
async function loadSettings() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  const form = document.getElementById('settings-form');

  const setVal = (name, val) => {
    const el = form.querySelector(`[name="${name}"]`);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!val;
    else el.value = val ?? '';
  };

  setVal('horizon', cfg.horizon);
  setVal('decay_base', cfg.decay_base);
  setVal('ft_value', cfg.ft_value);
  setVal('hit_cost', cfg.hit_cost);
  setVal('weekly_hit_limit', cfg.weekly_hit_limit);
  setVal('max_defenders_per_team', cfg.max_defenders_per_team);
  setVal('xmin_lb', cfg.xmin_lb);
  setVal('no_transfer_last_gws', cfg.no_transfer_last_gws);
  setVal('no_opposing_play', cfg.no_opposing_play);
  setVal('preseason', cfg.preseason);
  setVal('solver', cfg.solver);
  setVal('solve_name', cfg.solve_name);

  if (cfg.chip_limits) {
    setVal('chip_limits_wc', cfg.chip_limits.wc ?? 0);
    setVal('chip_limits_bb', cfg.chip_limits.bb ?? 0);
    setVal('chip_limits_fh', cfg.chip_limits.fh ?? 0);
    setVal('chip_limits_tc', cfg.chip_limits.tc ?? 0);
  }

  if (Array.isArray(cfg.locked)) setVal('locked', cfg.locked.join(', '));
  if (Array.isArray(cfg.banned)) setVal('banned', cfg.banned.join(', '));
}

document.getElementById('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const parseIds = str => str.split(',').map(s => s.trim()).filter(Boolean).map(Number);

  const data = {
    horizon:               Number(form.horizon.value),
    decay_base:            parseFloat(form.decay_base.value),
    ft_value:              parseFloat(form.ft_value.value),
    hit_cost:              Number(form.hit_cost.value),
    weekly_hit_limit:      Number(form.weekly_hit_limit.value),
    max_defenders_per_team: Number(form.max_defenders_per_team.value),
    xmin_lb:               Number(form.xmin_lb.value),
    no_transfer_last_gws:  Number(form.no_transfer_last_gws.value),
    no_opposing_play:      form.no_opposing_play.checked,
    preseason:             form.preseason.checked,
    solver:                form.solver.value,
    solve_name:            form.solve_name.value,
    locked:                parseIds(form.locked.value),
    banned:                parseIds(form.banned.value),
    chip_limits: {
      wc: Number(form.chip_limits_wc.value),
      bb: Number(form.chip_limits_bb.value),
      fh: Number(form.chip_limits_fh.value),
      tc: Number(form.chip_limits_tc.value),
      am: 0,
    },
  };

  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  const status = document.getElementById('save-status');
  status.textContent = '✓ Saved';
  setTimeout(() => { status.textContent = ''; }, 2500);
});

loadSettings();

/* ── File uploads ───────────────────────────────────────────── */
function setupDrop(dropId, inputId, statusId, endpoint) {
  const drop = document.getElementById(dropId);
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('dragover');
    if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0], endpoint, drop, status);
  });
  input.addEventListener('change', () => {
    if (input.files[0]) uploadFile(input.files[0], endpoint, drop, status);
  });
}

async function uploadFile(file, endpoint, drop, status) {
  status.textContent = 'Uploading…';
  status.className = 'file-status';
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch(endpoint, { method: 'POST', body: fd });
    const data = await res.json();
    if (data.status === 'ok') {
      drop.classList.add('success');
      status.textContent = `✓ ${file.name} uploaded`;
      status.className = 'file-status ok';
    } else {
      status.textContent = data.error || 'Upload failed';
      status.className = 'file-status error';
    }
  } catch {
    status.textContent = 'Upload failed';
    status.className = 'file-status error';
  }
}

setupDrop('drop-review', 'input-review', 'status-review', '/api/upload/review');
setupDrop('drop-team',   'input-team',   'status-team',   '/api/upload/team');

async function loadFileStatus() {
  const res = await fetch('/api/files/status');
  const d = await res.json();
  const table = document.getElementById('file-status-table');
  const row = (label, ok, note) =>
    `<tr><td>${label}</td><td class="${ok ? 'status-ok' : 'status-missing'}">${ok ? '✓ Present' : '✗ Missing'}</td><td style="color:#6b7280;font-size:.83rem">${note}</td></tr>`;
  table.innerHTML = `<table class="status-table">
    <thead><tr><th>File</th><th>Status</th><th>Note</th></tr></thead>
    <tbody>
      ${row('fplreview.csv', d.review, 'Player projections — required to run optimizer')}
      ${row('team.json', d.team, 'Current squad — optional (uses API if team_id set)')}
    </tbody>
  </table>`;
}

/* ── Run ────────────────────────────────────────────────────── */
let currentJobId = null;
let pollTimer = null;

document.getElementById('run-btn').addEventListener('click', async () => {
  if (currentJobId) return; // already running
  clearInterval(pollTimer);

  const logContainer = document.getElementById('log-container');
  logContainer.innerHTML = '';
  setBadge('running');
  document.getElementById('run-btn').disabled = true;

  const res = await fetch('/api/run', { method: 'POST' });
  const d = await res.json();
  currentJobId = d.job_id;

  let logLen = 0;
  pollTimer = setInterval(async () => {
    const job = await fetch(`/api/job/${currentJobId}`).then(r => r.json());
    const lines = job.log || [];
    // append new lines
    for (let i = logLen; i < lines.length; i++) {
      const div = document.createElement('div');
      div.className = 'log-line' + (lines[i].startsWith('ERROR') ? ' err' : '');
      div.textContent = lines[i];
      logContainer.appendChild(div);
      logContainer.scrollTop = logContainer.scrollHeight;
    }
    logLen = lines.length;

    if (job.status === 'done' || job.status === 'error') {
      clearInterval(pollTimer);
      setBadge(job.status);
      document.getElementById('run-btn').disabled = false;
      currentJobId = null;

      if (job.status === 'done') {
        // Auto-load results
        setTimeout(() => {
          document.querySelector('.tab[data-tab="results"]').click();
          loadResultFiles().then(() => loadResults());
        }, 600);
      }
    }
  }, 1000);
});

function setBadge(state) {
  const b = document.getElementById('run-status-badge');
  b.className = 'badge ' + state;
  b.textContent = state;
}

/* ── Results ────────────────────────────────────────────────── */
async function loadResultFiles() {
  const res = await fetch('/api/results/files');
  const d = await res.json();
  const sel = document.getElementById('result-file-select');
  sel.innerHTML = '<option value="">-- select a result file --</option>';

  if (d.results.length) {
    const g = document.createElement('optgroup');
    g.label = 'Results';
    d.results.forEach(f => {
      const o = document.createElement('option');
      o.value = f; o.textContent = f;
      g.appendChild(o);
    });
    sel.appendChild(g);
  }
  if (d.samples.length) {
    const g = document.createElement('optgroup');
    g.label = 'Sample outputs';
    d.samples.forEach(f => {
      const o = document.createElement('option');
      o.value = 'sample:' + f; o.textContent = f;
      g.appendChild(o);
    });
    sel.appendChild(g);
  }
}

document.getElementById('load-results-btn').addEventListener('click', () => loadResults());

async function loadResults(filename) {
  const sel = document.getElementById('result-file-select');
  const chosen = filename || sel.value;

  let url = '/api/results';
  if (chosen && chosen.startsWith('sample:')) {
    // We don't have a separate sample endpoint; just use default fallback
    url = '/api/results';
  } else if (chosen) {
    url = `/api/results?file=${encodeURIComponent(chosen)}`;
  }

  const res = await fetch(url);
  const d = await res.json();

  if (!d.rows || d.rows.length === 0) {
    document.getElementById('results-container').innerHTML =
      '<div class="empty-state">No results found. Run the optimizer first.</div>';
    return;
  }

  renderResults(d.rows, d.file);
}

const POS_MAP = { '1': 'GKP', '2': 'DEF', '3': 'MID', '4': 'FWD' };

function renderResults(rows, filename) {
  // Group by week
  const byWeek = {};
  rows.forEach(r => {
    const w = r.week;
    if (!byWeek[w]) byWeek[w] = [];
    byWeek[w].push(r);
  });

  let html = `<p style="color:var(--muted);font-size:.82rem;margin-bottom:1rem;">File: <strong>${filename}</strong></p>`;

  Object.keys(byWeek).sort((a, b) => Number(a) - Number(b)).forEach(week => {
    const players = byWeek[week];
    const lineup  = players.filter(p => p.lineup === '1');
    const bench   = players.filter(p => p.lineup === '0');
    const transIn  = players.filter(p => p.transfer_in  === '1');
    const transOut = players.filter(p => p.transfer_out === '1');

    const chipBadges = [];
    // Detect chip from data if present
    players.forEach(p => {
      if (p.chip && p.chip !== '' && p.chip !== 'none') {
        chipBadges.push(`<span class="chip-badge">${p.chip.toUpperCase()}</span>`);
      }
    });
    if (transIn.length > 0) {
      chipBadges.push(`<span class="transfer-badge">↔ ${transIn.length} transfer${transIn.length > 1 ? 's' : ''}</span>`);
    }

    html += `<div class="gw-block">
      <div class="gw-header">
        <span class="gw-title">Gameweek ${week}</span>
        <div class="gw-chips">${chipBadges.join('')}</div>
      </div>
      <div class="gw-body">
        <table class="player-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Pos</th>
              <th>Team</th>
              <th>Price</th>
              <th>xP</th>
              <th>Role</th>
              <th>Transfer</th>
            </tr>
          </thead>
          <tbody>
            <tr class="section-label"><td colspan="7">Starting XI</td></tr>
            ${lineup.sort(sortPlayers).map(playerRow).join('')}
            <tr class="section-label"><td colspan="7">Bench</td></tr>
            ${bench.sort(sortPlayers).map(p => playerRow(p, true)).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  });

  document.getElementById('results-container').innerHTML = html;
}

function sortPlayers(a, b) {
  return Number(a.type) - Number(b.type);
}

function playerRow(p, isBench) {
  const pos = POS_MAP[p.type] || p.pos || '?';
  const isCap = p.captain === '1';
  const isVC  = p.vicecaptain === '1';
  const isIn  = p.transfer_in  === '1';
  const isOut = p.transfer_out === '1';

  const roleBadge = isCap ? '<span class="captain-badge">C</span>' :
                    isVC  ? '<span class="vc-badge">V</span>' : '';
  const transferCol = isIn  ? '<span class="transfer-in">▲ IN</span>' :
                      isOut ? '<span class="transfer-out">▼ OUT</span>' : '';

  return `<tr class="${isBench ? 'bench' : ''}">
    <td>${p.name}${roleBadge}</td>
    <td><span class="pos-badge pos-${pos}">${pos}</span></td>
    <td>${p.team}</td>
    <td>£${parseFloat(p.price).toFixed(1)}m</td>
    <td>${parseFloat(p.xP).toFixed(2)}</td>
    <td>${roleBadge ? (isCap ? 'Captain' : 'Vice-captain') : (isBench ? 'Bench' : 'Starter')}</td>
    <td>${transferCol}</td>
  </tr>`;
}

// Init
loadResultFiles();
