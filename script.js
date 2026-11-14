(() => {
  'use strict';

  // =====================================================
  // ★ 설정: 아이콘 링크
  //   - 라인 아이콘은 여기 5개만 채우면 모든 줄(1팀/2팀)에 적용되고,
  //     적용·주사위·스왑을 눌러도 항상 유지됩니다.
  //   - 비워두면(빈 문자열) index.html 의 <img src="..."> 값을 그대로 씁니다.
  //   - SWAP_ICON 을 비워두면 ⇄ 글자가 표시됩니다.
  // =====================================================
  const LANE_ICONS = {
    top: '',
    jungle: '',
    mid: '',
    adc: '',
    support: '',
  };
  const SWAP_ICON = '';
  // 이름을 적으면 이름 왼쪽에 나타나는 아이콘 (모든 선수 공통). 비워두면 표시하지 않음
  const NAME_ICON = './assets/icon.webp';
  // '토너먼트 코드' 버튼을 누르면 새 탭으로 열리는 링크 (비워두면 안내 문구가 표시됨)
  const TOURNAMENT_URL = 'http://clash.deeplol.gg/tournament';

  // =====================================================
  // 라인업 파싱 + 팀 밸런싱
  // =====================================================
  const LANES = ['top', 'jungle', 'mid', 'adc', 'support'];
  const LANE_ALIAS = {
    '탑': 'top', 'top': 'top',
    '정글': 'jungle', 'jungle': 'jungle', 'jg': 'jungle',
    '미드': 'mid', 'mid': 'mid',
    '원딜': 'adc', '원딜러': 'adc', '바텀': 'adc', 'adc': 'adc', 'ad': 'adc',
    '서폿': 'support', '서포터': 'support', '서폿터': 'support', 'support': 'support', 'sup': 'support',
    'all': 'all', '올': 'all', '전체': 'all',
  };
  const TOLERANCE_MIN = 3; // 최적 점수차가 이보다 작아도 이 값까지는 허용

  const $ = (sel) => document.querySelector(sel);
  const textarea = $('#lineupInput');
  const msg = $('#lineupMsg');

  const setMsg = (text, isError = false) => {
    msg.textContent = text;
    msg.classList.toggle('error', isError);
  };

  // ---------- 아이콘 ----------
  // 라인 아이콘은 사람이 아니라 '라인'에 붙어 있으므로, 설정값이 있으면 항상 같은 값으로 유지
  function applyLaneIcons() {
    document.querySelectorAll('.summoner').forEach((row) => {
      const url = LANE_ICONS[row.dataset.lane];
      const img = row.querySelector('.laneIcon');
      if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
    });
  }

  function applySwapIcons() {
    if (!SWAP_ICON) return;
    document.querySelectorAll('.swapBtn').forEach((btn) => {
      btn.textContent = '';
      const img = document.createElement('img');
      img.src = SWAP_ICON;
      img.alt = '';
      btn.appendChild(img);
    });
  }

  // ---------- 이름 아이콘 ----------
  // 자리는 처음부터 차지하고(visibility) 있어서, 아이콘이 나타나도 이름 위치는 바뀌지 않음
  function initNameIcons() {
    document.querySelectorAll('.summoner').forEach((row) => {
      const img = document.createElement('img');
      img.className = 'nameIcon';
      img.alt = '';
      if (NAME_ICON) img.src = NAME_ICON;
      row.insertBefore(img, row.querySelector('.sumNameInput'));
    });
  }

  function syncNameIcons() {
    document.querySelectorAll('.summoner').forEach((row) => {
      const has = !!NAME_ICON && row.querySelector('.sumNameInput').value.trim() !== '';
      row.querySelector('.nameIcon').classList.toggle('on', has);
    });
  }

  applyLaneIcons();
  applySwapIcons();
  initNameIcons();
  document.querySelectorAll('.sumNameInput').forEach((el) => el.addEventListener('input', syncNameIcons));
  syncNameIcons();

  // "17P/오윤석 - 원딜,정글" 형태 10줄 -> 플레이어 배열
  function parseLineup(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length !== 10) {
      throw new Error(`10명이 필요합니다. (현재 ${lines.length}명)`);
    }
    return lines.map((line, i) => {
      const m = line.match(/^(\d+(?:\.\d+)?)\s*[pP]\s*\/\s*(.+)$/);
      if (!m) throw new Error(`${i + 1}번째 줄 형식 오류: "포인트P/이름 - 라인"으로 적어주세요.`);
      const point = Number(m[1]);
      const rest = m[2];
      const dm = rest.match(/^(.+)[-–—]([^-–—]*)$/);
      if (!dm || !dm[1].trim() || !dm[2].trim()) {
        throw new Error(`${i + 1}번째 줄에 "이름 - 라인"이 없습니다.`);
      }
      const name = dm[1].trim();
      const laneTokens = dm[2].split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      const prefs = [];
      let all = false;
      for (const t of laneTokens) {
        const key = LANE_ALIAS[t.toLowerCase()];
        if (!key) throw new Error(`${i + 1}번째 줄: 알 수 없는 라인 "${t}"`);
        if (key === 'all') all = true;
        else if (!prefs.includes(key)) prefs.push(key);
      }
      const allowed = all ? LANES.map((_, li) => li) : prefs.map((k) => LANES.indexOf(k));
      // 선호 순위: 라인 인덱스 -> 비용 (주 라인 0, 두 번째 1 ...). ALL은 전부 0
      const cost = LANES.map((_, li) => (all ? 0 : prefs.indexOf(LANES[li])));
      return { name, point, allowed, cost };
    });
  }

  // 가능한 모든 배치를 탐색해 후보 풀을 만든다.
  function buildPool(players) {
    const n = players.length; // 10
    const pts = players.map((p) => p.point);
    const laneOf = new Array(n).fill(-1);
    const count = [0, 0, 0, 0, 0];
    const leaves = []; // 가능한 라인 배정(laneOf 복사본)

    (function assign(i) {
      if (i === n) { leaves.push(laneOf.slice()); return; }
      for (const l of players[i].allowed) {
        if (count[l] >= 2) continue;
        count[l]++; laneOf[i] = l;
        assign(i + 1);
        count[l]--; laneOf[i] = -1;
      }
    })(0);

    if (!leaves.length) return null;

    // 라인별 (낮은 번호 선수, 높은 번호 선수)
    const pairsOf = (lo) => {
      const pr = [[], [], [], [], []];
      for (let i = 0; i < n; i++) pr[lo[i]].push(i);
      return pr;
    };

    // 1팀 = 각 라인 쌍에서 pr[l][0] (mask 비트 0) 또는 pr[l][1] (비트 1)
    // 대칭 제거를 위해 탑 라인은 항상 비트 0
    const evalLeaf = (pr, cb) => {
      const d = pr.map(([a, b]) => pts[a] - pts[b]);
      for (let mask = 0; mask < 32; mask += 2) {
        let sum = 0;
        for (let l = 0; l < 5; l++) sum += (mask >> l) & 1 ? -d[l] : d[l];
        cb(mask, Math.abs(sum));
      }
    };
    const offOf = (lo) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += players[i].cost[lo[i]];
      return s;
    };

    // 1차: 최소 점수차
    let best = Infinity;
    for (const lo of leaves) {
      evalLeaf(pairsOf(lo), (m, diff) => { if (diff < best) best = diff; });
    }
    const tol = Math.max(TOLERANCE_MIN, best);

    // 2차: 허용 점수차 이내 후보 수집 (선호 라인 위반이 적은 순으로 층 구성)
    const tiers = new Map(); // off -> [{lo, mask, diff}]
    let minOff = Infinity;
    for (const lo of leaves) {
      const off = offOf(lo);
      if (off > minOff + 1) continue;
      const pr = pairsOf(lo);
      evalLeaf(pr, (mask, diff) => {
        if (diff > tol) return;
        if (off < minOff) {
          minOff = off;
          for (const k of [...tiers.keys()]) if (k > minOff + 1) tiers.delete(k);
        }
        if (!tiers.has(off)) tiers.set(off, []);
        tiers.get(off).push({ lo, mask, diff });
      });
    }
    const levels = [...tiers.keys()].sort((a, b) => a - b);
    return {
      players,
      tiers: levels.map((k) => ({ off: k, list: tiers.get(k), used: new Set() })),
      total: levels.reduce((s, k) => s + tiers.get(k).length, 0),
      shown: 0,
      best,
      tol,
    };
  }

  // 풀에서 아직 보여주지 않은 후보 하나를 무작위로 뽑는다 (선호 위반이 적은 층 우선)
  function pickNext(pool) {
    for (const tier of pool.tiers) {
      if (tier.used.size < tier.list.length) {
        let idx;
        do { idx = Math.floor(Math.random() * tier.list.length); } while (tier.used.has(idx));
        tier.used.add(idx);
        pool.shown++;
        return tier.list[idx];
      }
    }
    return null; // 전부 소진
  }

  // 후보 -> 화면 슬롯 채우기
  function renderSolution(pool, sol) {
    const { players } = pool;
    const pr = [[], [], [], [], []];
    sol.lo.forEach((l, i) => pr[l].push(i));
    LANES.forEach((lane, l) => {
      const [a, b] = pr[l];
      const flip = (sol.mask >> l) & 1;
      fillSlot(1, lane, players[flip ? b : a]);
      fillSlot(2, lane, players[flip ? a : b]);
    });
    applyLaneIcons(); // 사람이 바뀌어도 아이콘 유지
    syncNameIcons();
    updateScores();
  }

  const getRow = (team, lane) =>
    document.querySelector(`.summoner[data-team="${team}"][data-lane="${lane}"]`);

  function fillSlot(team, lane, player) {
    const row = getRow(team, lane);
    row.querySelector('.sumNameInput').value = player.name;
    row.querySelector('.sumPointInput').value = player.point;
  }

  // 점수 합 표시 (슬롯의 포인트 input 기준)
  const teamSum = (team) => [...document.querySelectorAll(`.summoner[data-team="${team}"] .sumPointInput`)]
    .reduce((s, el) => s + (Number(el.value) || 0), 0);
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  function updateScores() {
    $('#scoreA').textContent = fmt(teamSum(1));
    $('#scoreB').textContent = fmt(teamSum(2));
  }
  document.querySelectorAll('.sumPointInput').forEach((el) => el.addEventListener('input', updateScores));

  // ---------- 같은 라인 좌우 스왑 ----------
  document.querySelectorAll('.swapBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lane = btn.dataset.lane;
      const a = getRow(1, lane);
      const b = getRow(2, lane);
      ['.sumNameInput', '.sumPointInput'].forEach((sel) => {
        const ea = a.querySelector(sel);
        const eb = b.querySelector(sel);
        [ea.value, eb.value] = [eb.value, ea.value];
      });
      syncNameIcons();
      updateScores();
      setMsg(`${a.querySelector('.laneIcon').alt} 라인의 좌우를 교체했습니다.`);
    });
  });

  // ---------- 밸런스 복사 ----------
  const LANE_LABEL = {
    top: '탑    ',
    jungle: '정글 ',
    mid: '미드 ',
    adc: '원딜 ',
    support: '서폿 ',
  };

  function buildBalanceText() {
    const cell = (team, lane) => {
      const row = getRow(team, lane);
      const name = row.querySelector('.sumNameInput').value.trim();
      const point = Number(row.querySelector('.sumPointInput').value) || 0;
      return `${name}(${fmt(point)})`;
    };
    const lines = LANES.map((lane) => `${LANE_LABEL[lane]}${cell(1, lane)} ${cell(2, lane)}`);
    return `${lines.join('\n')}\n\n[총 합] ${fmt(teamSum(1))} : ${fmt(teamSum(2))}`;
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    // 보안 컨텍스트가 아닐 때(file:// 등)를 위한 대체 방법
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (!ok) throw new Error('복사 실패');
  }

  $('#copyBalanceBtn').addEventListener('click', async () => {
    try {
      await copyText(buildBalanceText());
      setMsg('밸런스를 복사했습니다.');
    } catch (e) {
      setMsg('복사에 실패했습니다. 브라우저 권한을 확인해주세요.', true);
    }
  });

  // ---------- 초기화 (이름·포인트 전부 비우기) ----------
  $('#resetBtn').addEventListener('click', () => {
    document.querySelectorAll('.sumNameInput, .sumPointInput').forEach((el) => { el.value = ''; });
    clearWarn();
    syncNameIcons();
    updateScores();
    setMsg('이름과 포인트를 모두 초기화했습니다.');
  });

  // ---------- 토너먼트 코드 (외부 링크) ----------
  $('#tournamentBtn').addEventListener('click', () => {
    if (!TOURNAMENT_URL) {
      setMsg('script.js 상단의 TOURNAMENT_URL 에 링크를 넣어주세요.', true);
      return;
    }
    window.open(TOURNAMENT_URL, '_blank', 'noopener,noreferrer');
  });

  // ---------- 빨간 테두리 경고 (3초) ----------
  let warnTimer = null;

  function clearWarn() {
    clearTimeout(warnTimer);
    document.querySelectorAll('.summoner.warn').forEach((r) => r.classList.remove('warn'));
  }

  function flashWarn(rows) {
    clearWarn();
    rows.forEach((r) => { void r.offsetWidth; r.classList.add('warn'); });
    warnTimer = setTimeout(clearWarn, 3000);
  }

  // ---------- 배정 불가 시: 형식·인원·라인이 안 맞아도 최대한 채워 넣기 ----------
  // 형식이 틀린 줄도 버리지 않고 읽는다. 라인 정보가 없으면 ALL 로 취급.
  function parseLenient(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return lines.map((line) => {
      const m = line.match(/^(\d+(?:\.\d+)?)\s*[pP]?\s*\/\s*(.+)$/);
      const point = m ? Number(m[1]) : 0;
      const rest = m ? m[2] : line;
      const dm = rest.match(/^(.+)[-–—]([^-–—]*)$/);
      const name = (dm ? dm[1] : rest).trim();
      const prefs = [];
      let all = !dm;
      if (dm) {
        for (const t of dm[2].split(/[,，、]/).map((x) => x.trim()).filter(Boolean)) {
          const key = LANE_ALIAS[t.toLowerCase()];
          if (key === 'all') all = true;
          else if (key && !prefs.includes(key)) prefs.push(key);
        }
        if (!prefs.length) all = true;
      }
      const allowed = all ? LANES.map((_, i) => i) : prefs.map((k) => LANES.indexOf(k));
      return { name, point, allowed };
    });
  }

  const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);

  function fallbackFill(text) {
    let players = parseLenient(text);
    if (!players.length) { setMsg('라인업을 입력해주세요.', true); return; }
    const over = Math.max(0, players.length - 10);
    players = players.slice(0, 10);

    // 슬롯 = 라인 * 2 + (0|1). 희망 라인에 최대한 많은 사람을 넣는다(이분 매칭).
    const slotOf = new Array(10).fill(-1);
    const tryAssign = (p, seen) => {
      for (const l of players[p].allowed) {
        for (let k = 0; k < 2; k++) {
          const s = l * 2 + k;
          if (seen.has(s)) continue;
          seen.add(s);
          if (slotOf[s] === -1 || tryAssign(slotOf[s], seen)) { slotOf[s] = p; return true; }
        }
      }
      return false;
    };
    const unmatched = [];
    shuffle(players.map((_, i) => i)).forEach((p) => {
      if (!tryAssign(p, new Set())) unmatched.push(p);
    });

    // 희망 라인에 못 들어간 사람은 남은 빈 슬롯에 임의로 배치
    const forced = new Set();
    const empty = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((s) => slotOf[s] === -1));
    unmatched.forEach((p) => { slotOf[empty.shift()] = p; forced.add(p); });

    // 라인별로 묶고, 좌우(1팀/2팀) 배치는 점수 차가 가장 적은 쪽으로
    const lanes = LANES.map((_, l) => [slotOf[l * 2], slotOf[l * 2 + 1]].filter((p) => p !== -1));
    const pt = (p) => (p === undefined ? 0 : players[p].point);
    let bestDiff = Infinity;
    let bestMasks = [];
    for (let mask = 0; mask < 32; mask++) {
      let d = 0;
      lanes.forEach((pr, l) => {
        const f = (mask >> l) & 1;
        d += f ? pt(pr[1]) - pt(pr[0]) : pt(pr[0]) - pt(pr[1]);
      });
      d = Math.abs(d);
      if (d < bestDiff - 1e-9) { bestDiff = d; bestMasks = [mask]; }
      else if (Math.abs(d - bestDiff) < 1e-9) bestMasks.push(mask);
    }
    const mask = bestMasks[Math.floor(Math.random() * bestMasks.length)];

    // 화면 채우기
    document.querySelectorAll('.sumNameInput, .sumPointInput').forEach((el) => { el.value = ''; });
    const warnRows = [];
    LANES.forEach((lane, l) => {
      const pr = lanes[l];
      const f = (mask >> l) & 1;
      [[1, f ? pr[1] : pr[0]], [2, f ? pr[0] : pr[1]]].forEach(([team, p]) => {
        const row = getRow(team, lane);
        if (p === undefined) { warnRows.push(row); return; } // 비어 있는 칸
        fillSlot(team, lane, players[p]);
        if (forced.has(p)) warnRows.push(row);                // 임의 배치된 칸
      });
    });
    applyLaneIcons();
    syncNameIcons();
    updateScores();
    flashWarn(warnRows);

    const notes = [];
    if (players.length < 10) notes.push(`인원이 ${players.length}명이라 빈 자리가 있습니다.`);
    if (forced.size) notes.push(`희망 라인에 들어갈 자리가 없는 ${forced.size}명을 남은 자리에 임의로 배치했습니다.`);
    if (over) notes.push(`10명을 넘은 ${over}명은 제외했습니다.`);
    if (warnRows.length) notes.push('빨간 테두리 칸을 확인해주세요.');
    else notes.push('입력 형식을 보정해서 배치했습니다.');
    setMsg(notes.join('\n'), warnRows.length > 0);
  }

  // ---------- 적용 / 주사위 ----------
  let pool = null;
  let poolText = null;

  function showNext() {
    let sol = pickNext(pool);
    let wrapped = false;
    if (!sol) { // 모든 경우를 다 보여줌 -> 처음부터 다시
      pool.tiers.forEach((t) => t.used.clear());
      pool.shown = 0;
      wrapped = true;
      sol = pickNext(pool);
    }
    renderSolution(pool, sol);
    const a = Number($('#scoreA').textContent), b = Number($('#scoreB').textContent);
    let text = `경우의 수 ${pool.shown}/${pool.total} · 점수 차 ${Math.round(Math.abs(a - b) * 10) / 10}`;
    if (wrapped) text += '\n모든 경우를 보여드려 처음부터 다시 돌립니다.';
    setMsg(text);
  }

  function run() {
    const text = textarea.value;
    clearWarn();
    try {
      if (!pool || text !== poolText) {
        const built = buildPool(parseLineup(text));
        if (!built) throw new Error('배정 불가');
        pool = built;
        poolText = text;
      }
      showNext();
    } catch (e) {
      // 오류 문구 대신 → 임의로 채우고 문제 칸을 빨간 테두리로 표시
      pool = null;
      poolText = null;
      fallbackFill(text);
    }
  }

  $('#applyBtn').addEventListener('click', run);
  $('#diceBtn').addEventListener('click', run);
})();
