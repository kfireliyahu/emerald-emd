/* B · The statement — Home and its tabs. */
(function () {
  const K = window.KIT, Y = window.YEAR
  const $ = (s) => document.querySelector(s)
  let ym = Y.opening
  const open = new Set(['out']) // which lines are open, kept while you page months
  const he = () => K.state.lang === 'he'
  const idx = () => Y.months.findIndex((m) => m.ym === ym)
  const month = () => Y.months[idx()]

  function bar() {
    const w = K.w()
    $('#bar').innerHTML = `<b>Emerald</b><span class="doc"><bdi>year.emd</bdi></span>
      <div class="tools"><button id="lang" type="button">${K.icon('lang')}${w.lang}</button><button id="theme" type="button" aria-label="${w.theme}" title="${w.theme}">${K.icon('sun')}</button></div>`
    $('#lang').onclick = () => { K.setLang(he() ? 'en' : 'he'); draw() }
    $('#theme').onclick = () => { K.cycleTheme(); draw() }
    const tabs = ['home', 'year', 'transactions', 'paychecks', 'plan', 'wealth', 'categories']
    $('#tabs').innerHTML = tabs.map((k) => `<a href="#${k}" ${k === 'home' ? 'aria-current="page"' : ''}>${w.rail[k]}</a>`).join('') +
      `<span class="sp"></span><button class="more" id="more" type="button" aria-haspopup="menu" aria-expanded="false">${w.rail.document}${K.icon('down', 14)}</button>`
    $('#more').onclick = (e) => {
      const b = e.currentTarget, was = b.getAttribute('aria-expanded') === 'true'
      document.querySelectorAll('.menu').forEach((m) => m.remove())
      b.setAttribute('aria-expanded', String(!was))
      if (was) return
      const r = b.getBoundingClientRect(), m = document.createElement('div')
      m.className = 'menu'; m.setAttribute('role', 'menu')
      m.innerHTML = ['formats', 'assistants', 'settings'].map((k) => `<a role="menuitem" href="#${k}">${w.rail[k]}</a>`).join('')
      m.style.top = r.bottom + 'px'
      if (K.rtl()) m.style.left = r.left + 'px'; else m.style.right = innerWidth - r.right + 'px'
      document.body.appendChild(m); m.querySelector('a').focus()
    }
  }

  function strip() {
    const w = K.w(), ms = Y.months, n = ms.length, i = idx()
    const W = 1000, H = 118, base = 88, top = 8, max = 2400000, slot = W / n, bw = 24
    const x = (j) => { const c = slot * j + slot / 2; return K.rtl() ? W - c : c }
    const h = (v) => ((base - top) * Math.max(0, v)) / max
    const col = (m, j) => {
      const cx = x(j), hh = h(m.out), y0 = base - hh
      const cls = `c ${j === i ? 'on' : ''} ${m.running ? 'run' : ''}`
      const d = `M${cx - bw / 2},${base}V${y0 + 4}Q${cx - bw / 2},${y0} ${cx - bw / 2 + 4},${y0}H${cx + bw / 2 - 4}Q${cx + bw / 2},${y0} ${cx + bw / 2},${y0 + 4}V${base}Z`
      const tick = m.in > 0 ? `<line class="tick" x1="${cx - bw / 2 - 4}" x2="${cx + bw / 2 + 4}" y1="${base - h(m.in)}" y2="${base - h(m.in)}"/>` : ''
      const miss = m.missing ? `<circle class="miss" cx="${cx}" cy="${H - 2}" r="3"/>` : ''
      return `<path class="${cls}" d="${d}"/>${tick}<text x="${cx}" y="${base + 16}" text-anchor="middle" class="${j === i ? 'on' : ''}">${K.monthName(m.ym, 'short')}</text>${miss}
        <rect class="hit" data-j="${j}" x="${cx - slot / 2}" y="0" width="${slot}" height="${H}"><title>${K.monthName(m.ym)}</title></rect>`
    }
    const yearMark = ms.map((m, j) => (m.ym.endsWith('-01') ? `<text x="${x(j) + (K.rtl() ? slot / 2 - 2 : -slot / 2 + 2)}" y="${H}" text-anchor="${K.rtl() ? 'end' : 'start'}">${m.ym.slice(0, 4)}</text>` : '')).join('')
    return `<div class="strip"><svg viewBox="0 0 ${W} ${H + 4}" role="img" aria-label="${w.flows.out}, ${w.months}">
      <defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--col)"/><line x1="0" y1="0" x2="0" y2="5" stroke="var(--ink-2)" stroke-width="2"/></pattern></defs>
      <line class="base" x1="0" x2="${W}" y1="${base}" y2="${base}"/>${ms.map(col).join('')}${yearMark}</svg>
      <div class="key"><span><i style="background:var(--col-on)"></i>${w.flows.out}</span><span><i style="height:2px;vertical-align:3px;background:var(--in)"></i>${w.flows.in}</span><span><i style="background:var(--out);border-radius:50%;width:6px;height:6px;vertical-align:1px"></i>${w.missing}</span><span>${w.keys}</span></div></div>`
  }

  const cell = (minor, cls = '') => `<span class="r amt ${cls}">${minor === null ? '—' : K.money(minor)}</span>`
  function compare(key) {
    const m = month(), a = K.avg3(ym, key), p = K.pct(m[key], a)
    return `<span class="r avg">${a === null ? '—' : K.money(a, { whole: true })}</span><span class="r chg">${p === null ? '' : K.signed(p)}</span>`
  }
  function line(key, label, flow, kids, why = '') {
    const isOpen = open.has(key)
    return `<div class="line"><button class="row" type="button" aria-expanded="${isOpen}" data-k="${key}">
        <span class="chev">${K.icon('right', 14)}</span><span class="lab">${label}${why ? `<span class="why">${why}</span>` : ''}</span>${cell(month()[flow], 'f-' + flow)}${compare(flow)}</button>
      <div class="more-rows ${isOpen ? 'open' : ''}"><div>${kids}</div></div></div>`
  }
  const sub = (key, label, minor, kids, extra = '') => {
    if (!kids) return `<div class="sub"><div class="row"><span></span><span class="lab">${label}${extra}</span>${cell(minor)}<span></span><span></span></div></div>`
    const isOpen = open.has(key)
    return `<div class="sub"><button class="row" type="button" aria-expanded="${isOpen}" data-k="${key}"><span class="chev">${K.icon('right', 12)}</span><span class="lab">${label}${extra}</span>${cell(minor)}<span></span><span></span></button>
      <div class="more-rows ${isOpen ? 'open' : ''}"><div>${kids}</div></div></div>`
  }

  function statement() {
    const w = K.w(), m = month()
    const cats = Y.categories(ym), top = cats.length ? cats[0].minor : 1
    const incomeKids = Y.income(ym).map((l) => sub('', K.bdi(l.name), l.minor, null, l.kind === 'slip' ? `<span class="why">${w.netPay}</span>` : '')).join('') || `<div class="leaf"><span></span><span class="lab">${he() ? 'עוד לא נכנס כלום החודש' : 'Nothing has come in yet this month'}</span></div>`
    const catKids = cats.map((c) => {
      const leaves = c.rows.map((r) => `<div class="leaf"><span></span><span class="lab"><span class="d">${K.day(r.date)}</span>${K.bdi(r.shop)}</span><span class="r">${K.money(r.minor)}</span><span></span><span></span></div>`).join('') +
        `<div class="leaf all"><span></span><span class="lab"><a href="#transactions">${w.allRows}</a></span></div>`
      return sub('cat:' + c.id, `<span class="dotc" style="background:var(--cat-${c.hue})"></span>${K.bdi(K.name(c))}<span class="why">${c.rows.length} ${c.rows.length === 1 ? w.row : w.rows}</span>`, c.minor, leaves)
    }).join('')
    const savedKids = Y.saved(ym).map((s) => sub('', K.bdi(K.name(s)), s.minor, null, `<span class="why">${s.from === 'slip' ? (he() ? 'מהתלוש' : 'off the slip') : s.from === 'goal' ? (he() ? 'ליעד' : 'into a goal') : (he() ? 'מחסכונות קודמים' : 'from earlier savings')}</span>`)).join('')
    const taxKids = m.tax === null ? '' : [[he() ? 'מס הכנסה' : 'Income tax', Math.round(m.tax * 0.6845)], [he() ? 'ביטוח לאומי' : 'National insurance', Math.round(m.tax * 0.1824)], [he() ? 'מס בריאות' : 'Health tax', m.tax - Math.round(m.tax * 0.6845) - Math.round(m.tax * 0.1824)]].map(([a, b]) => sub('', a, b, null)).join('')
    return `<section class="stmt" aria-label="${K.monthName(ym)}">
      <div class="cols-h"><span></span><span></span><span>${K.monthName(ym, 'month')}</span><span>${w.average}</span><span>${he() ? 'שינוי' : 'Change'}</span></div>
      ${line('in', w.flows.in, 'in', incomeKids)}
      ${line('out', w.flows.out, 'out', catKids, m.missing ? `<span style="color:var(--out)">· ${w.missing}</span>` : '')}
      <div class="line equals"><div class="row"><span></span><span class="lab">${w.flows.left}<span class="why">${w.flowHow.left}</span></span>${cell(m.left)}${compare('left')}</div></div>
      ${line('saved', w.flows.saved, 'saved', savedKids)}
      ${line('tax', w.flows.tax, 'tax', taxKids, `<span class="why">${he() ? 'מהתלוש' : 'off the slip'}</span>`)}
    </section>`
  }

  function notes() {
    const w = K.w()
    const items = [[w.w_uncat, w.w_uncatWhy, w.w_uncatDo], [w.w_bills, w.w_billsWhy, w.w_billsDo], [w.w_hold, w.w_holdWhy, w.w_holdDo]]
    const meters = Y.plan(ym).map((p) => {
      const over = p.spent > p.minor, pv = Math.min(100, Math.round((100 * p.spent) / p.minor)), diff = Math.abs(p.minor - p.spent)
      return `<div class="meter"><span>${K.bdi(K.name(p))}</span><span class="r">${K.money(p.spent, { whole: true })} <span>/ ${K.money(p.minor, { whole: true })}</span></span>
        <span class="track"><span class="fill ${over ? 'over' : ''}" style="width:${pv}%"></span></span><span class="note ${over ? 'over' : ''}">${K.money(diff, { whole: true })} ${over ? w.over + ' ' + w.budget : w.left}</span></div>`
    }).join('')
    return `<aside class="notes">
      <section aria-labelledby="h-open"><h2 id="h-open">${w.waiting}<span>3</span></h2>
        ${items.map(([a, b, c], j) => `<div class="item"><span class="n">${j + 1}</span><p>${a}</p><span></span><span class="why">${b}</span><a href="#answer">${c}</a></div>`).join('')}</section>
      <section aria-labelledby="h-plan"><h2 id="h-plan">${w.againstPlan}</h2>${meters}</section>
    </aside>`
  }

  function main() {
    const w = K.w(), m = month()
    const rows = Y.categories(ym).reduce((a, c) => a + c.rows.length, 0)
    $('#main').innerHTML = `<article class="sheet">
      <div class="head"><h1 aria-live="polite">${K.monthName(ym)}</h1>
        <span class="span">${rows} ${w.rows}${m.running ? ' · ' + w.running : ''}</span>${m.missing ? `<span class="span warn">${w.missing}: ${K.bdi(m.missing.en)}</span>` : ''}
        <button class="primary" type="button">${K.icon('read')}${w.readFiles}</button></div>
      ${strip()}
      <div class="body swap">${statement()}${notes()}</div>
      <div class="foot"><span>${he() ? 'שורה נפתחת במקומה · Enter' : 'A line opens where it is · Enter'}</span><span>${w.keys}</span></div>
    </article>`
    wire()
  }

  function go(step) {
    const j = idx() + step
    if (j < 0 || j >= Y.months.length) return
    ym = Y.months[j].ym
    const had = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null
    main()
    if (had) { const b = document.querySelector(`[data-k="${had}"]`); if (b) b.focus() }
  }

  function wire() {
    document.querySelectorAll('button.row[data-k]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.k, now = !open.has(k)
      now ? open.add(k) : open.delete(k)
      b.setAttribute('aria-expanded', String(now))
      b.nextElementSibling.classList.toggle('open', now)
    }))
    const tip = $('#tip'), w = K.w()
    document.querySelectorAll('.strip .hit').forEach((r) => {
      const j = Number(r.dataset.j), m = Y.months[j]
      r.onclick = () => go(j - idx())
      r.onmousemove = (e) => {
        tip.innerHTML = `<b>${K.monthName(m.ym)}${m.running ? ' · ' + w.running : ''}</b><div><span>${w.flows.in}</span><span>${K.money(m.in, { whole: true })}</span></div><div><span>${w.flows.out}</span><span>${K.money(m.out, { whole: true })}</span></div><div><span>${w.flows.left}</span><span>${K.money(m.left, { whole: true })}</span></div>${m.missing ? `<div style="color:var(--out)">${w.missing}</div>` : ''}`
        tip.hidden = false; tip.style.left = Math.min(innerWidth - 200, e.clientX + 14) + 'px'; tip.style.top = e.clientY + 16 + 'px'
      }
      r.onmouseleave = () => (tip.hidden = true)
    })
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { document.querySelectorAll('.menu').forEach((m) => m.remove()); const mb = $('#more'); if (mb) mb.setAttribute('aria-expanded', 'false') }
    else if (e.key === K.olderKey()) { e.preventDefault(); go(-1) }
    else if (e.key === K.newerKey()) { e.preventDefault(); go(1) }
  })
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu, #more')) { document.querySelectorAll('.menu').forEach((m) => m.remove()); const mb = $('#more'); if (mb) mb.setAttribute('aria-expanded', 'false') } })

  function draw() { bar(); main() }
  draw()
  window.PROTO = { go, toggle: (k) => { open.has(k) ? open.delete(k) : open.add(k); main() } }
})()
