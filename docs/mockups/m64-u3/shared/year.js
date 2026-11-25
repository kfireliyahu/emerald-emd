/* U16's synthetic year (.demo/year.emd, made from fixtures/synthetic/demo/year/year.json),
   as the three prototypes draw it. Made up end to end: no figure here is anyone's.

   The fourteen months' totals are year_summary's, to the agora. October 2026's categories,
   rows, income and saving are month_summary's (rows authored from the fixture's own shops so
   they sum to its figures). The other months' breakdowns are scaled from October's for the
   prototype: their totals are exact, their split is illustrative. Money is integer agorot. */
(function () {
  const C = (minor) => minor // integer agorot, never a float
  const M = [
    // ym, came in, went out, saved, taxes (off the slip), left over
    ['2025-10', 1660120, 740420, 398250, 581630, 919700],
    ['2025-11', 1660120, 1246176, 438250, 581630, 413944],
    ['2025-12', 2350260, 1409145, 398250, 795290, 941115],
    ['2026-01', 1660120, 1273263, 438250, 581630, 386857],
    ['2026-02', 1660120, 1401849, 398250, 581630, 258271],
    ['2026-03', 1663920, 1507065, 438250, 581630, 156855],
    ['2026-04', 1660120, 1558917, 398250, 581630, 101203],
    ['2026-05', 1660120, 1439713, 438250, 581630, 220407],
    ['2026-06', 1776998, 1447503, 409300, 612492, 329495],
    ['2026-07', 1748208, 1374934, 3449300, 612492, 373274],
    ['2026-08', 1748208, 1265125, 409300, 612492, 483083],
    ['2026-09', 1752008, 1060595, 449300, 612492, 691413],
    ['2026-10', 1754658, 1345832, 449300, 612492, 408826],
    ['2026-11', 0, 1393409, 190000, null, -1393409],
  ]
  const months = M.map(([ym, inn, out, saved, tax, left]) => ({
    ym, in: C(inn), out: C(out), saved: C(saved), tax: tax === null ? null : C(tax), left: C(left),
    running: ym === '2026-11',
    // The second card's October statement was never read (the fixture's "missing": 10).
    missing: ym === '2026-09' ? { en: 'כרטיס לדוגמה 5678', he: 'כרטיס לדוגמה 5678' } : null,
  }))

  const CATS = {
    rent: { en: 'Housing & Rent', he: 'דיור ושכירות', hue: 1 },
    groceries: { en: 'Groceries', he: 'סופר ומכולת', hue: 3 },
    loans: { en: 'Loan payments', he: 'החזרי הלוואות', hue: 10 },
    fuel: { en: 'Fuel', he: 'דלק', hue: 2 },
    restaurants: { en: 'Restaurants & Cafes', he: 'מסעדות ובתי קפה', hue: 8 },
    municipal: { en: 'Municipal tax', he: 'ארנונה', hue: 11 },
    shopping: { en: 'Shopping & Clothing', he: 'קניות וביגוד', hue: 4 },
    electricity: { en: 'Electricity', he: 'חשמל', hue: 7 },
    none: { en: 'Uncategorized', he: 'ללא קטגוריה', hue: 0 },
    fitness: { en: 'Fitness', he: 'כושר', hue: 6 },
    connectivity: { en: 'Internet & Mobile', he: 'אינטרנט וסלולר', hue: 5 },
    pharmacy: { en: 'Pharmacy', he: 'בית מרקחת', hue: 9 },
    subscriptions: { en: 'Subscriptions', he: 'מנויים', hue: 5 },
    bankfees: { en: 'Bank fees', he: 'עמלות בנק', hue: 10 },
  }

  // October 2026, as month_summary reads it. [day, shop, agorot]
  const OCT = {
    rent: [[3, 'שכר דירה הוראת קבע', 520000]],
    groceries: [[3, 'Greenleaf Market', 41250], [5, 'סופר השכונה לדוגמה', 18960], [7, 'מאפיית הדוגמה', 4870], [9, 'Greenleaf Market', 28790], [12, 'Harbor Foods', 86440], [14, 'סופר השכונה לדוגמה', 27430], [17, 'Greenleaf Market', 47320], [20, 'מאפיית הדוגמה', 8653], [22, 'סופר השכונה לדוגמה', 21080], [26, 'Greenleaf Market', 33910]],
    loans: [[12, 'הלוואה לרכב לדוגמה', 100000]],
    fuel: [[4, 'Northway Fuel', 26820], [16, 'Northway Fuel', 29150], [29, 'Northway Fuel', 25566]],
    restaurants: [[2, 'Little Bean Cafe', 3800], [8, 'Little Bean Cafe', 4450], [11, 'Copper Kettle', 18400], [15, 'Little Bean Cafe', 2900], [18, 'מסעדת הגן הבדויה', 28100], [23, 'Little Bean Cafe', 5100], [25, 'Copper Kettle', 13230]],
    municipal: [[15, 'ארנונה עיריית הדוגמה', 61000]],
    shopping: [[16, 'Cosy Home Appliances', 60000]],
    electricity: [[18, 'חשמל לדוגמה', 49445]],
    none: [[6, 'חנות הפינה הבדויה', 12843], [13, 'Pixel Arcade', 8900], [27, 'Pixel Arcade', 6450]],
    fitness: [[1, 'חדר כושר לדוגמה', 18900]],
    connectivity: [[3, 'Fastline Internet', 11990], [4, 'Parrot Mobile', 5990]],
    pharmacy: [[10, 'בית מרקחת בדוי', 6415]],
    subscriptions: [[6, 'StreamBox', 5490]],
    bankfees: [[28, 'עמלת ניהול חשבון', 2190]],
  }
  const FIXED = ['rent', 'loans', 'municipal', 'fitness', 'connectivity', 'subscriptions', 'bankfees']
  const VARIABLE = { groceries: 0.56, restaurants: 0.13, fuel: 0.14, shopping: 0.07, electricity: 0.05, none: 0.04, pharmacy: 0.01 }

  // A small seeded generator, so every month draws the same split each time.
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }

  function rows(id, ym, total, count, random) {
    const shops = [...new Set(OCT[id].map((r) => r[1]))]
    if (count <= 1) return [[OCT[id][0][0], shops[0], total]]
    const weights = Array.from({ length: count }, () => 0.5 + random())
    const sum = weights.reduce((a, b) => a + b, 0)
    let given = 0
    return weights.map((w, i) => {
      const amount = i === count - 1 ? total - given : Math.floor((total * w) / sum)
      given += amount
      return [Math.min(28, 1 + Math.floor(((i + random()) * 28) / count)), shops[i % shops.length], amount]
    })
  }

  const cache = new Map()
  function categories(ym) {
    if (cache.has(ym)) return cache.get(ym)
    const month = months.find((m) => m.ym === ym)
    let list
    if (ym === '2026-10') {
      list = Object.entries(OCT).map(([id, r]) => ({ id, rows: r, minor: r.reduce((a, x) => a + x[2], 0) }))
    } else {
      const random = rng(Number(ym.replace('-', '')))
      const fixed = FIXED.map((id) => ({ id, rows: OCT[id], minor: OCT[id].reduce((a, x) => a + x[2], 0) }))
      const fixedTotal = fixed.reduce((a, c) => a + c.minor, 0)
      let rest = Math.max(0, month.out - fixedTotal)
      const parity = Number(ym.slice(5)) % 2 === 0
      const weights = Object.entries(VARIABLE).map(([id, w]) => [id, id === 'electricity' && !parity ? 0 : w * (0.7 + random() * 0.6)])
      const wsum = weights.reduce((a, [, w]) => a + w, 0)
      let given = 0
      const variable = weights.filter(([, w]) => w > 0).map(([id, w], i, all) => {
        const minor = i === all.length - 1 ? rest - given : Math.floor((rest * w) / wsum)
        given += minor
        return { id, minor, rows: rows(id, ym, minor, OCT[id].length, random) }
      })
      // When the month is smaller than its bills (the first month, read part-way), the bills shrink with it.
      if (month.out < fixedTotal) {
        let left = month.out
        list = fixed.map((c) => { const minor = Math.min(c.minor, left); left -= minor; return { ...c, minor, rows: [[c.rows[0][0], c.rows[0][1], minor]] } }).filter((c) => c.minor > 0)
      } else list = [...fixed, ...variable]
    }
    list = list.filter((c) => c.minor > 0).map((c) => ({ ...c, ...CATS[c.id], rows: c.rows.map(([d, shop, minor]) => ({ date: `${ym}-${String(d).padStart(2, '0')}`, shop, minor })).sort((a, b) => a.date.localeCompare(b.date)) }))
    list.sort((a, b) => b.minor - a.minor)
    cache.set(ym, list)
    return list
  }

  function income(ym) {
    const month = months.find((m) => m.ym === ym)
    if (month.in === 0) return []
    const pay = ym === '2025-12' ? 2350260 : month.in >= 1748208 ? 1748208 : 1660120
    const lines = [{ name: 'Sample Works Ltd', kind: 'slip', minor: Math.min(pay, month.in) }]
    if (month.in > pay) lines.push({ name: 'בית מרקחת בדוי', kind: 'other', minor: month.in - pay })
    return lines
  }

  function saved(ym) {
    const month = months.find((m) => m.ym === ym)
    const slip = month.tax === null ? 0 : month.tax > 600000 ? 154800 + 64500 : 147000 + 61250
    const parts = []
    if (slip > 0) parts.push({ id: 'pension', en: 'Pension', he: 'פנסיה', minor: month.tax > 600000 ? 154800 : 147000, from: 'slip' })
    if (slip > 0) parts.push({ id: 'study', en: 'Study fund', he: 'קרן השתלמות', minor: month.tax > 600000 ? 64500 : 61250, from: 'slip' })
    let rest = month.saved - slip
    const goals = Math.min(rest, 230000)
    if (goals > 0) {
      const emergency = Math.min(goals, 150000)
      parts.push({ id: 'emergency', en: 'Emergency fund', he: 'קרן חירום', minor: emergency, from: 'goal' })
      if (goals - emergency > 0) parts.push({ id: 'trip', en: 'Trip to the coast', he: 'טיול לחוף', minor: goals - emergency, from: 'goal' })
    }
    rest -= goals
    if (rest > 0) parts.push({ id: 'moved', en: 'Moved to investments', he: 'הועבר להשקעות', minor: rest, from: 'moved' })
    return parts
  }

  const PLAN = [
    { id: 'groceries', minor: 320000 },
    { id: 'restaurants', minor: 35000 },
    { id: 'fuel', minor: 90000 },
  ]
  function plan(ym) {
    const cats = categories(ym)
    return PLAN.map((p) => ({ ...p, ...CATS[p.id], spent: (cats.find((c) => c.id === p.id) || { minor: 0 }).minor }))
  }

  window.YEAR = { months, categories, income, saved, plan, opening: '2026-10', CATS }
})()

/* Formatting and the small things every prototype shares. */
window.KIT = (function () {
  const params = new URLSearchParams(location.search)
  const store = {
    get(k) { try { return localStorage.getItem('m64u3:' + k) } catch { return null } },
    set(k, v) { try { localStorage.setItem('m64u3:' + k, v) } catch { /* private window */ } },
  }
  const state = {
    lang: params.get('lang') || store.get('lang') || 'en',
    theme: params.get('theme') || store.get('theme') || 'system',
  }
  function applyTheme() {
    const root = document.documentElement
    if (state.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', state.theme)
  }
  function applyLang() {
    const w = window.WORDS[state.lang]
    document.documentElement.lang = state.lang
    document.documentElement.dir = w.dir
  }
  if (params.has('still')) document.documentElement.classList.add('still')
  applyTheme(); applyLang()

  const locale = () => (state.lang === 'he' ? 'he-IL' : 'en-IL')
  // Integer agorot to text: shekels and agorot split by integer arithmetic, never by a float.
  function parts(minor) {
    const neg = minor < 0
    const abs = Math.abs(minor)
    const whole = Math.floor(abs / 100)
    const cents = String(abs % 100).padStart(2, '0')
    const int = new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(whole)
    return { neg, sym: '₪', int, dec: '.' + cents }
  }
  function money(minor, opts = {}) {
    const p = parts(minor)
    const sign = p.neg ? '−' : opts.plus && minor > 0 ? '+' : ''
    const text = `${sign}${p.sym}${p.int}${opts.whole ? '' : p.dec}`
    return '⁦' + text + '⁩' // an isolate, so a figure never reorders inside Hebrew
  }
  function compact(minor) {
    const shekels = Math.round(minor / 100)
    if (Math.abs(shekels) >= 1000) return '₪' + (Math.round(shekels / 100) / 10).toString() + 'K'
    return '₪' + shekels
  }
  function monthName(ym, style = 'long') {
    const [y, m] = ym.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1, 1))
    if (style === 'short') return new Intl.DateTimeFormat(locale(), { month: 'short', timeZone: 'UTC' }).format(d)
    if (style === 'month') return new Intl.DateTimeFormat(locale(), { month: 'long', timeZone: 'UTC' }).format(d)
    return new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
  }
  function day(date) {
    const [y, m, d] = date.split('-').map(Number)
    return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]) }
  // Anything that came out of a document goes in <bdi>: Hebrew or English, it keeps its own direction.
  function bdi(s) { return `<bdi>${esc(s)}</bdi>` }
  function avg3(ym, key) {
    const i = window.YEAR.months.findIndex((m) => m.ym === ym)
    const prev = window.YEAR.months.slice(Math.max(0, i - 3), i).filter((m) => !m.running && m[key] !== null)
    if (prev.length === 0) return null
    return Math.round(prev.reduce((a, m) => a + m[key], 0) / prev.length)
  }
  function pct(now, before) {
    if (before === null || before === 0 || now === null) return null
    return Math.round(((now - before) * 100) / Math.abs(before))
  }
  function signed(n) { return n === null ? '' : '⁦' + (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n) + '%⁩' }
  function setLang(lang) { state.lang = lang; store.set('lang', lang); applyLang() }
  function cycleTheme() {
    const dark = state.theme === 'dark' || (state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    state.theme = dark ? 'light' : 'dark'
    store.set('theme', state.theme)
    applyTheme()
  }
  const w = () => window.WORDS[state.lang]
  const name = (o) => o[state.lang] || o.en
  const rtl = () => state.lang === 'he'
  // The arrow key that points at older months: in Hebrew, time runs right to left.
  const olderKey = () => (rtl() ? 'ArrowRight' : 'ArrowLeft')
  const newerKey = () => (rtl() ? 'ArrowLeft' : 'ArrowRight')

  // Icons: authored here, one stroke (1.75) on a 24 grid — no icon library.
  const ICON = {
    home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
    year: '<rect x="4" y="5" width="16" height="15"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    rows: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    pay: '<rect x="5" y="3" width="14" height="18"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    plan: '<circle cx="12" cy="12" r="8"/><path d="M12 4v8h8"/>',
    wealth: '<path d="M4 20h16M6 20V10M10 20V6M14 20v-8M18 20V8"/>',
    tags: '<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
    formats: '<rect x="4" y="4" width="16" height="16"/><path d="M4 10h16M10 10v10"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
    read: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 19h16"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    lang: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  }
  function icon(nameOf, size = 16) {
    return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${ICON[nameOf]}</svg>`
  }
  return { state, money, parts, compact, monthName, day, esc, bdi, avg3, pct, signed, setLang, cycleTheme, w, name, rtl, olderKey, newerKey, icon, store }
})()
