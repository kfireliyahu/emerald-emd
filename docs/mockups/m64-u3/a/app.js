/* A · The report — Home and the rail. */
(function () {
  const K = window.KIT, Y = window.YEAR
  const $ = (s) => document.querySelector(s)
  let ym = Y.opening
  let panel = null // { kind: 'fig'|'cat'|'asks'|'rest', id }
  let lastFocus = null
  let firstDraw = true

  const fig = (minor, cls) => { const p = K.parts(minor); return `<span dir="ltr" class="num ${cls || ''}">${p.neg ? '−' : ''}<span class="sym">${p.sym}</span>${p.int}<span class="dec">${p.dec}</span></span>` }
  const idx = () => Y.months.findIndex((m) => m.ym === ym)
  const month = () => Y.months[idx()]

  function rail() {
    const w = K.w()
    const money = ['home', 'year', 'transactions', 'paychecks', 'plan', 'wealth', 'categories']
    const doc = ['formats', 'assistants', 'settings']
    const link = (k) => `<a href="#${k}" ${k === 'home' ? 'aria-current="page"' : ''}>${w.rail[k]}</a>`
    $('#rail').innerHTML = `
      <div class="doc"><b>Emerald</b><span><bdi>year.emd</bdi></span></div>
      <h2>${w.rail.money}</h2>${money.map(link).join('')}
      <h2>${w.rail.document}</h2>${doc.map(link).join('')}
      <div class="foot">
        <button id="lang" type="button">${K.icon('lang')}${w.lang}</button>
        <button id="theme" type="button" aria-label="${w.theme}" title="${w.theme}">${K.icon('sun')}</button>
      </div>`
    $('#lang').onclick = () => { K.setLang(K.state.lang === 'he' ? 'en' : 'he'); draw() }
    $('#theme').onclick = () => { K.cycleTheme(); draw() }
  }

  function vs(key) {
    const m = month(); const a = K.avg3(ym, key); const p = K.pct(m[key], a)
    return p === null ? '' : `${K.signed(p)} ${K.w().vsAvg}`
  }

  function chart() {
    const w = K.w(), months = Y.months, n = months.length
    const W = 1024, H = 200, padT = 16, padB = 28, padX = 8, endPad = 72
    const max = 2400000
    const x = (i) => { const t = padX + (i * (W - padX * 2 - endPad)) / (n - 1); return K.rtl() ? W - t : t }
    const y = (v) => padT + (H - padT - padB) * (1 - v / max)
    const line = (key, upto) => months.slice(0, upto).map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(m[key]).toFixed(1)}`).join('')
    const done = n - 1 // the running month is drawn dashed
    const ticks = [0, 1000000, 2000000].map((v) => `<line class="grid" x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${K.rtl() ? W : 0}" y="${y(v) - 4}" text-anchor="${K.rtl() ? 'end' : 'start'}">${K.compact(v)}</text>`).join('')
    const i = idx()
    const labels = months.map((m, j) => `<text x="${x(j)}" y="${H - 8}" text-anchor="middle" class="${j === i ? 'on' : ''}">${K.monthName(m.ym, 'short')}</text>`).join('')
    const last = months[done - 1]
    const ex = x(done - 1) + (K.rtl() ? -10 : 10), anchor = K.rtl() ? 'end' : 'start'
    const hits = months.map((m, j) => { const bw = (W - padX * 2 - endPad) / (n - 1); return `<rect class="hit" data-ym="${m.ym}" x="${x(j) - bw / 2}" y="${padT}" width="${bw}" height="${H - padT - padB + 16}"/>` }).join('')
    const sel = `<line class="sel" x1="${x(i)}" x2="${x(i)}" y1="${padT}" y2="${H - padB}"/><circle class="dot" cx="${x(i)}" cy="${y(months[i].in)}" r="4.5" fill="var(--in)"/><circle class="dot" cx="${x(i)}" cy="${y(Math.max(0, months[i].out))}" r="4.5" fill="var(--out)"/>`
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${w.flows.in} / ${w.flows.out}, ${w.months}" class="${firstDraw ? 'drawn' : ''}">
      ${ticks}
      <path class="l-in" d="${line('in', done)}" pathLength="1"/><path class="l-out" d="${line('out', done)}" pathLength="1"/>
      <path class="l-out run" d="M${x(done - 1)},${y(months[done - 1].out)}L${x(done)},${y(months[done].out)}"/>
      ${sel}
      <text class="end" x="${ex}" y="${y(last.in) + 4}" text-anchor="${anchor}">${w.flows.in}</text>
      <text class="end" x="${ex}" y="${y(last.out) + 4}" text-anchor="${anchor}">${w.flows.out}</text>
      ${labels}${hits}</svg>`
  }

  function where() {
    const w = K.w(), cats = Y.categories(ym), top = cats[0].minor
    const shown = cats.slice(0, 6), rest = cats.slice(6)
    const restSum = rest.reduce((a, c) => a + c.minor, 0)
    const row = (c) => `<li><button type="button" data-cat="${c.id}">
      <span class="nm"><span class="dotc" style="background:var(--cat-${c.hue})"></span>${K.bdi(K.name(c))}${c.id === 'none' ? `<span class="sub">· ${c.rows.length} ${w.rows}</span>` : ''}</span>
      <span class="bar ${c.id === 'none' ? 'unknown' : ''}" style="width:${Math.max(3, Math.round((100 * c.minor) / top))}%"></span>
      <span class="amt">${K.money(c.minor)}</span></button></li>`
    return `<section class="block" aria-labelledby="h-where"><header><h2 id="h-where">${w.whereItWent}</h2><span>${cats.length} ${K.state.lang === 'he' ? 'קטגוריות' : 'categories'}</span></header>
      <ul class="rank">${shown.map(row).join('')}
      ${rest.length ? `<li class="more"><button type="button" data-rest="1"><span class="nm">${K.state.lang === 'he' ? `עוד ${rest.length} קטגוריות` : `${rest.length} more categories`}</span><span class="bar" style="width:${Math.max(3, Math.round((100 * restSum) / top))}%;opacity:.35"></span><span class="amt">${K.money(restSum)}</span></button></li>` : ''}
      </ul><div class="total"><span>${w.flows.out}</span><span class="num f-out">${K.money(month().out)}</span></div></section>`
  }

  function right() {
    const w = K.w(), plan = Y.plan(ym), parts = Y.saved(ym), m = month()
    const sum = parts.reduce((a, p) => a + p.minor, 0) || 1
    const shade = { slip: 'var(--ink-3)', goal: 'var(--saved)', moved: 'var(--in)' }
    const meters = plan.map((p) => {
      const over = p.spent > p.minor, pctv = Math.min(100, Math.round((100 * p.spent) / p.minor))
      const diff = Math.abs(p.minor - p.spent)
      return `<li><button type="button" data-cat="${p.id}"><span>${K.bdi(K.name(p))}</span><span class="m-amt">${K.money(p.spent, { whole: true })} <span>/ ${K.money(p.minor, { whole: true })}</span></span>
        <span class="track"><span class="fill ${over ? 'over' : ''}" style="width:${pctv}%"></span></span>
        <span class="note ${over ? 'over' : ''}">${over ? `${K.money(diff, { whole: true })} ${w.over} ${w.budget}` : `${K.money(diff, { whole: true })} ${w.left}`}</span></button></li>`
    }).join('')
    return `<div>
      <section class="block" aria-labelledby="h-plan"><header><h2 id="h-plan">${w.againstPlan}</h2></header><ul class="meters">${meters}</ul></section>
      <section class="block" aria-labelledby="h-saved" style="margin-top:40px"><header><h2 id="h-saved">${w.flows.saved}</h2><span class="num f-saved">${K.money(m.saved)}</span></header>
        <div class="seg" role="img" aria-label="${parts.map((p) => K.name(p) + ' ' + K.money(p.minor)).join(', ')}">${parts.map((p) => `<span style="flex:${p.minor / sum};background:${shade[p.from]}"></span>`).join('')}</div>
        <ul class="saved-list">${parts.map((p) => `<li><span class="dotc" style="background:${shade[p.from]}"></span><bdi>${K.name(p)}</bdi><span class="src">${p.from === 'slip' ? (K.state.lang === 'he' ? 'מהתלוש' : 'off the slip') : p.from === 'goal' ? (K.state.lang === 'he' ? 'ליעד' : 'into a goal') : ''}</span><span class="num">${K.money(p.minor)}</span></li>`).join('')}</ul>
      </section></div>`
  }

  function main() {
    const w = K.w(), m = month(), i = idx()
    const name = K.monthName(ym)
    const prev = i > 0, next = i < Y.months.length - 1
    const figs = ['in', 'out', 'saved', 'tax'].map((k) => `<button class="fig" type="button" data-fig="${k}">
        <span class="label">${w.flows[k]} ${K.icon('arrow', 12).replace('class="ico"', 'class="ico flip"')}</span>
        <span class="val f-${k}">${m[k] === null ? '—' : fig(m[k])}</span>
        <span class="vs">${m[k] === null ? (K.state.lang === 'he' ? 'אין תלוש לחודש הזה' : 'No paycheck this month') : vs(k)}</span></button>`).join('')
    const missing = m.missing ? `<span class="state" style="color:var(--out)">· ${w.missing}: ${K.bdi(m.missing.en)}</span>` : m.running ? `<span class="state">· ${w.running}</span>` : ''
    const leftVs = K.pct(m.left, K.avg3(ym, 'left'))
    $('#main').innerHTML = `<div class="page">
      <div class="top">
        <div class="pager"><button type="button" id="prev" aria-label="${w.prev}" ${prev ? '' : 'disabled'}>${K.icon('left')}</button>
        <h1 aria-live="polite">${name}</h1>
        <button type="button" id="next" aria-label="${w.next}" ${next ? '' : 'disabled'}>${K.icon('right')}</button></div>${missing}
        <button class="btn" type="button">${K.icon('read')}${w.readFiles}</button>
      </div>
      <div class="lead swap" style="--dir:${dir}">
        <p class="sentence">${m.in === 0 ? (K.state.lang === 'he' ? `ב${K.monthName(ym, 'month')} יצאו עד עכשיו <span class="f f-out">${K.money(m.out, { whole: true })}</span>.` : `So far in ${K.monthName(ym, 'month')}, <span class="f f-out">${K.money(m.out, { whole: true })}</span> went out.`) : K.state.lang === 'he' ? `ב${K.monthName(ym, 'month')} נכנסו <span class="f f-in">${K.money(m.in, { whole: true })}</span> ויצאו <span class="f f-out">${K.money(m.out, { whole: true })}</span>.` : `In ${K.monthName(ym, 'month')}, <span class="f f-in">${K.money(m.in, { whole: true })}</span> came in and <span class="f f-out">${K.money(m.out, { whole: true })}</span> went out.`}</p>
        <div class="hero"><span class="big num">${fig(m.left)}</span><span class="what"><b>${w.flows.left}</b><span>${leftVs === null ? w.flowHow.left : `${K.signed(leftVs)} ${w.vsAvg}`}</span></span></div>
      </div>
      <aside class="asks" aria-label="${w.waiting}">
        <div class="ask"><b>${K.state.lang === 'he' ? '3 שאלות משנות את סיכומי החודש' : '3 questions change this month’s totals'}</b><p>${w.w_uncat}.</p>
        <button class="link" type="button" data-asks="1">${K.state.lang === 'he' ? 'מענה' : 'Answer them'} ${K.icon('arrow', 14).replace('class="ico"', 'class="ico flip"')}</button></div>
      </aside>
      <div class="figs">${figs}</div>
      <section class="block" aria-labelledby="h-trend"><header><h2 id="h-trend">${w.months}</h2><span>${K.state.lang === 'he' ? 'עמודה פותחת את החודש שלה' : 'A month opens when you click it'}</span></header><div class="chart" id="chart">${chart()}</div></section>
      <div class="cols swap" style="--dir:${dir}">${where()}${right()}</div>
      <p class="keys">${w.keys}</p>
    </div>`
    firstDraw = false
    $('#prev').onclick = () => go(-1)
    $('#next').onclick = () => go(1)
    wire()
  }

  let dir = 1
  function go(step) {
    const j = idx() + step
    if (j < 0 || j >= Y.months.length) return
    dir = (K.rtl() ? -step : step)
    ym = Y.months[j].ym
    main()
    if (panel) openPanel(panel, false)
  }

  function wire() {
    document.querySelectorAll('[data-fig]').forEach((b) => (b.onclick = () => openPanel({ kind: 'fig', id: b.dataset.fig }, true, b)))
    document.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => openPanel({ kind: 'cat', id: b.dataset.cat }, true, b)))
    document.querySelectorAll('[data-rest]').forEach((b) => (b.onclick = () => openPanel({ kind: 'rest' }, true, b)))
    document.querySelectorAll('[data-asks]').forEach((b) => (b.onclick = () => openPanel({ kind: 'asks' }, true, b)))
    const tip = $('#tip'), w = K.w()
    document.querySelectorAll('#chart .hit').forEach((r) => {
      r.onclick = () => { const j = Y.months.findIndex((m) => m.ym === r.dataset.ym); go(j - idx()) }
      r.onmousemove = (e) => {
        const m = Y.months.find((x) => x.ym === r.dataset.ym)
        tip.innerHTML = `<b>${K.monthName(m.ym)}${m.running ? ' · ' + w.running : ''}</b><div><span><i style="background:var(--in)"></i>${w.flows.in}</span><span>${K.money(m.in, { whole: true })}</span></div><div><span><i style="background:var(--out)"></i>${w.flows.out}</span><span>${K.money(m.out, { whole: true })}</span></div><div><span>${w.flows.left}</span><span>${K.money(m.left, { whole: true })}</span></div>`
        tip.hidden = false
        tip.style.left = Math.min(innerWidth - 200, e.clientX + 14) + 'px'; tip.style.top = e.clientY + 14 + 'px'
      }
      r.onmouseleave = () => (tip.hidden = true)
    })
  }

  function rowsTable(rows, total) {
    const w = K.w()
    return `<table class="rows"><thead><tr><th>${w.date}</th><th>${w.shop}</th><th class="r">${w.amount}</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="d">${K.day(r.date)}</td><td>${K.bdi(r.shop)}</td><td class="r">${K.money(r.minor)}</td></tr>`).join('')}
      <tr class="t"><td></td><td></td><td class="r">${K.money(total)}</td></tr></tbody></table>`
  }

  function openPanel(p, focus, from) {
    panel = p
    if (from) lastFocus = from
    const w = K.w(), m = month(), el = $('#panel')
    let title = '', body = ''
    const big = (minor) => `<div class="pbig num">${fig(minor)}</div>`
    if (p.kind === 'cat') {
      const c = Y.categories(ym).find((x) => x.id === p.id)
      title = K.bdi(K.name(Y.CATS[p.id]))
      body = c ? `${big(c.minor)}<p class="lead2">${c.rows.length} ${c.rows.length === 1 ? w.row : w.rows} · ${Math.round((100 * c.minor) / m.out)}% ${w.share}</p>${rowsTable(c.rows, c.minor)}<p class="foot"><a class="link" href="#transactions">${w.allRows}</a></p>` : `<p class="lead2">—</p>`
    } else if (p.kind === 'rest') {
      const rest = Y.categories(ym).slice(6)
      title = K.state.lang === 'he' ? 'שאר הקטגוריות' : 'The other categories'
      body = `${big(rest.reduce((a, c) => a + c.minor, 0))}<table class="rows"><tbody>${rest.map((c) => `<tr><td><span class="dotc" style="display:inline-block;margin-inline-end:8px;background:var(--cat-${c.hue})"></span>${K.bdi(K.name(c))}</td><td class="r">${K.money(c.minor)}</td></tr>`).join('')}</tbody></table>`
    } else if (p.kind === 'asks') {
      title = w.waiting
      body = [[w.w_uncat, w.w_uncatWhy, w.w_uncatDo], [w.w_bills, w.w_billsWhy, w.w_billsDo], [w.w_hold, w.w_holdWhy, w.w_holdDo]].map(([a, b, c]) => `<div class="ask"><b>${a}</b><p>${b}</p><button class="link" type="button">${c}</button></div>`).join('')
    } else {
      const k = p.id
      title = w.flows[k]
      const lines = k === 'in' ? Y.income(ym).map((l) => [K.bdi(l.name), l.kind === 'slip' ? w.netPay : '', l.minor])
        : k === 'out' ? Y.categories(ym).map((c) => [K.bdi(K.name(c)), `${c.rows.length} ${w.rows}`, c.minor])
        : k === 'saved' ? Y.saved(ym).map((s) => [K.bdi(K.name(s)), '', s.minor])
        : m.tax === null ? [] : [[K.state.lang === 'he' ? 'מס הכנסה' : 'Income tax', '', Math.round(m.tax * 0.6845)], [K.state.lang === 'he' ? 'ביטוח לאומי' : 'National insurance', '', Math.round(m.tax * 0.1824)], [K.state.lang === 'he' ? 'מס בריאות' : 'Health tax', '', m.tax - Math.round(m.tax * 0.6845) - Math.round(m.tax * 0.1824)]]
      body = `${m[k] === null ? '' : big(m[k])}<p class="lead2">${w.flowHow[k]}</p><table class="rows"><tbody>${lines.map(([a, b, c]) => `<tr><td>${a}${b ? ` <span style="color:var(--ink-2);font-size:.75rem">· ${b}</span>` : ''}</td><td class="r">${K.money(c)}</td></tr>`).join('')}</tbody></table>`
    }
    el.innerHTML = `<div class="in"><header><div><span class="kicker">${K.monthName(ym)}</span><h2 id="ph">${title}</h2></div><button class="x" type="button" id="close" aria-label="${w.close}" title="${w.close} (Esc)">${K.icon('close')}</button></header>${body}</div>`
    el.setAttribute('aria-labelledby', 'ph')
    el.removeAttribute('inert'); el.setAttribute('aria-hidden', 'false')
    $('#frame').classList.add('open')
    $('#close').onclick = closePanel
    if (focus) $('#close').focus({ preventScroll: true })
  }
  function closePanel() {
    panel = null
    const el = $('#panel')
    $('#frame').classList.remove('open')
    el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true')
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus()
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return
    if (e.key === 'Escape' && panel) { e.preventDefault(); closePanel() }
    else if (e.key === K.olderKey()) { e.preventDefault(); go(-1) }
    else if (e.key === K.newerKey()) { e.preventDefault(); go(1) }
  })

  function draw() { rail(); main(); if (panel) openPanel(panel, false) }
  draw()
  window.PROTO = { open: (p) => openPanel(p, true), go, close: closePanel }
})()
