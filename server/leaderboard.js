// Daily "Top traders" leaderboard.
//
// Privacy: real NovaTrade users are NEVER listed. The board is a fixed pool
// of 150 dummy traders; a rotating window of 15 is featured each day, so all
// 150 appear over a 10-day cycle before repeating. Profits are seeded by the
// day, so the board is stable within a day and changes at midnight (UTC).
//
// Threshold gate: the featured 15 hold the day's top-tier profits. A logged-in
// user only breaks into the top 15 if their own live profit today beats the
// 15th place (the threshold); otherwise they see their own profit with an
// approximate position label (e.g. "100+"), Quotex-style.

const FIRST = [
  'Viktor', 'Amara', 'Kenji', 'Lucia', 'Omar', 'Priya', 'Mateo', 'Zanele',
  'Ethan', 'Yulia', 'Rafael', 'Mei', 'Andre', 'Sofia', 'Chen', 'Fatima',
  'Diego', 'Anya', 'Hiro', 'Nadia', 'Luca', 'Elena', 'Ravi', 'Marta',
  'Yusuf', 'Ingrid', 'Pablo', 'Aisha', 'Noah', 'Lena',
];
const LAST = ['S.', 'O.', 'T.', 'M.', 'H.', 'R.', 'G.', 'K.', 'W.', 'P.', 'C.', 'L.', 'B.', 'N.', 'V.'];
const FLAGS = ['🇩🇪', '🇳🇬', '🇯🇵', '🇪🇸', '🇦🇪', '🇮🇳', '🇦🇷', '🇿🇦', '🇺🇸', '🇺🇦', '🇧🇷', '🇨🇳', '🇫🇷', '🇮🇹', '🇬🇧', '🇵🇰', '🇹🇷', '🇮🇩', '🇰🇷', '🇪🇬'];

const POOL = Array.from({ length: 150 }, (_, i) => ({
  name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`,
  country: FLAGS[i % FLAGS.length],
}));

const DAY_MS = 86400000;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

// 150 profits for the day, sorted high→low. Skewed so a few are very high.
function dayProfits(dayIndex) {
  const rng = mulberry32((dayIndex * 2654435761) >>> 0);
  const arr = Array.from({ length: 150 }, () => round2(300 + Math.pow(rng(), 2.2) * 24000));
  arr.sort((a, b) => b - a);
  return arr;
}

// now: ms timestamp. userName/userProfitToday: null when not logged in.
function buildLeaderboard(now, userName, userProfitToday) {
  const dayIndex = Math.floor(now / DAY_MS);
  const profits = dayProfits(dayIndex);
  const win = dayIndex % 10;                 // which 15 names are featured today
  const names = POOL.slice(win * 15, win * 15 + 15);
  let list = names.map((p, i) => ({ name: p.name, country: p.country, profit: profits[i], isYou: false }));
  const threshold = profits[14];             // 15th place = entry bar for the top 15

  let you = null;
  const up = round2(Number(userProfitToday) || 0);
  if (userName != null) {
    const rank = profits.filter((p) => p > up).length + 1; // rank among the 150 pool
    if (up <= 0) {
      you = { inTop: false, rank: null, profit: up, label: '—' };
    } else if (up > threshold) {
      list.push({ name: `${userName} (You)`, country: '🏆', profit: up, isYou: true });
      list.sort((a, b) => b.profit - a.profit);
      list = list.slice(0, 15);
      const r = list.findIndex((e) => e.isYou) + 1;
      you = { inTop: true, rank: r, profit: up, label: `#${r}` };
    } else {
      const label = rank > 100 ? '100+' : rank > 50 ? '50+' : rank > 15 ? '15+' : `#${rank}`;
      you = { inTop: false, rank, profit: up, label };
    }
  }

  list = list.map((e, i) => ({ rank: i + 1, ...e }));
  return { leaderboard: list, you, threshold };
}

module.exports = { buildLeaderboard };
