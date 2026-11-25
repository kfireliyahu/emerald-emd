/* C · The signpost — Home, its pages, the rail and the palette. */
(function () {
  const K = window.KIT, Y = window.YEAR
  const $ = (s) => document.querySelector(s)
  const he = () => K.state.lang === 'he'
  let ym = Y.opening
  let step = 0 // which waiting item the band shows
  let flap = false

  const fig = (minor) => { const p = K.parts(minor); return `<span dir="ltr">${p.neg ? '−' : ''}<span class="sym">${p.sym}</span>${p.int}<span class="dec">${p.dec}</span></span>` }
  const idx = () => Y.months.findIndex((m) => m.ym === ym)
  const month = () => Y.months[idx()]
  const arrow = (s = 18) => K.icon('arrow', s).replace('class="ico"', 'class="ico flip"')
  const route = () => (location.hash.replace(/^#\/?/, '') || '').split('/')

  const PLACES = ['home', 'year', 'transactions', 'paychecks', 'plan', 'wealth', 'categories']
  const DOC = ['formats', 'assistants', 'settings']
  const ICON = { home: 'home', year: 'year', transactions: 'rows', paychecks: 'pay', plan: 'plan', wealth: 'wealth', categories: 'tags', formats: 'formats', assistants: 'chat', settings: 'gear' }

  function rail() {
    const w = K.w(), here = route()[0] || 'home'
    const a = (k) => `<a href="#/${k === 'home' ? '' : 'place/' + k}" data-name="${w.rail[k]}" aria-label="${w.rail[k]}" ${(k === 'home' && (here === '' || here === 'home' || here === 'flow' || here === 'cat' || here === 'next')) || route()[1] === k ? 'aria-current="page"' : ''}>${K.icon(ICON[k], 20)}</a>`
    $('#rail').innerHTML = `<span class="mark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l9 10-9 10-9-10z"/></svg></span>
      ${PLACES.map(a).join('')}<span class="sep"></span>${DOC.map(a).join('')}
      <div class="end"><button type="button" id="lang" data-name="${w.lang}" aria-label="${w.lang}">${K.icon('lang', 20)}</button><button type="button" id="theme" data-name="${w.theme}" aria-label="${w.theme}">${K.icon('sun', 20)}</button></div>`
    $('#lang').onclick = () => { K.setLang(he() ? 'en' : 'he'); draw() }
    $('#theme').onclick = () => { K.cycleTheme(); draw() }
  }
  function cmd() {
    const w = K.w()
    $('#cmd').innerHTML = `<span class="doc"><b>Emerald</b> · <bdi>year.emd</bdi></span>
      <button class="ask" type="button" id="ask">${K.icon('search')}<span>${w.search}</span><kbd>Ctrl K</kbd></button>
      <button class="read" type="button">${K.icon('read')}${w.readFiles}</button>`
    $('#ask').onclick = openPalette
  }

  const ITEMS = () => { const w = K.w(); return [
    { msg: w.w_uncat, why: w.w_uncatWhy, act: w.w_uncatDo, to: '#/next/uncat', pict: 'tags' },
    { msg: w.w_bills, why: w.w_billsWhy, act: w.w_billsDo, to: '#/place/plan', pict: 'pay' },
    { msg: w.w_hold, why: w.w_holdWhy, act: w.w_holdDo, to: '#/place/wealth', pict: 'wealth' },
  ] }

  function band() {
    const it = ITEMS()[step], n = ITEMS().length
    return `<section class="band ${flap ? 'flap' : ''}" aria-label="${K.w().waiting}" aria-live="polite">
      <span class="pict">${K.icon(it.pict, 24)}</span>
      <span class="msg"><b>${it.msg}</b><span>${it.why}</span></span>
      <a class="go" href="${it.to}">${it.act} ${arrow(16)}</a>
      <span class="count"><button type="button" id="bprev" aria-label="${he() ? 'הקודם' : 'Previous'}">${K.icon('left', 16).replace('class="ico"', 'class="ico flip"')}</button>${step + 1} / ${n}<button type="button" id="bnext" aria-label="${he() ? 'הבא' : 'Next'}">${K.icon('right', 16).replace('class="ico"', 'class="ico flip"')}</button></span>
    </section>`
  }

  function leftOver() {
    const w = K.w(), ms = Y.months, n = ms.length, i = idx()
    const W = 960, H = 168, zero = 104, slot = W / n, bw = 22, scale = 96 / 1400000
    const x = (j) => { const c = slot * j + slot / 2; return K.rtl() ? W - c : c }
    const bars = ms.map((m, j) => {
      const v = Math.max(-1400000, m.left), hh = Math.max(2, Math.abs(v) * scale), cx = x(j), pos = v >= 0
      const y = pos ? zero - hh : zero
      const cls = `${pos ? 'p' : 'n'} ${j === i ? 'on' : ''}`
      const lab = j === i ? `<text class="lab" x="${cx}" y="${pos ? y - 6 : y + hh + 14}" text-anchor="middle">${K.compact(m.left)}</text>` : ''
      return `<rect class="${cls}" x="${cx - bw / 2}" y="${y}" width="${bw}" height="${hh}"/>${lab}<text x="${cx}" y="${H - 4}" text-anchor="middle" class="${j === i ? 'on' : ''}">${K.monthName(m.ym, 'short')}</text><rect class="hit" data-j="${j}" x="${cx - slot / 2}" y="0" width="${slot}" height="${H}"/>`
    }).join('')
    return `<div class="lo"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${w.flows.left}, ${w.months}">
      <defs><pattern id="negHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="var(--neg)" stroke-width="2"/></pattern></defs>
      <line class="zero" x1="0" x2="${W}" y1="${zero}" y2="${zero}"/>${bars}</svg></div>`
  }

  function home() {
    const w = K.w(), m = month(), i = idx()
    const cats = Y.categories(ym), top = cats[0].minor
    const state = m.missing ? `<span class="state warn">${w.missing}: ${K.bdi(m.missing.en)}</span>` : m.running ? `<span class="state">${w.running}</span>` : ''
    const sign = (k) => {
      const a = K.avg3(ym, k), p = K.pct(m[k], a)
      return `<a class="sign" href="#/flow/${k}"><span class="t"><b>${w.flows[k]}</b><span>${m[k] === null ? (he() ? 'אין תלוש לחודש הזה' : 'No paycheck this month') : p === null ? w.flowHow[k] : `${K.signed(p)} ${w.vsAvg}`}</span></span>
        <span class="v f-${k}">${m[k] === null ? '—' : fig(m[k])}</span><span class="arr">${arrow()}</span></a>`
    }
    const cat = (c) => `<a class="cat" href="#/cat/${c.id}"><span class="nm"><span class="dotc" style="background:var(--cat-${c.hue})"></span>${K.bdi(K.name(c))}</span>
      <span class="bar ${c.id === 'none' ? 'unknown' : ''}" style="width:${Math.max(3, Math.round((100 * c.minor) / top))}%"></span><span class="amt">${K.money(c.minor)}</span><span class="arr">${arrow(16)}</span></a>`
    return `<div class="page">
      ${band()}
      <div class="monthrow"><button type="button" id="prev" aria-label="${w.prev}" ${i > 0 ? '' : 'disabled'}>${K.icon('left', 18).replace('class="ico"', 'class="ico flip"')}</button><h1 aria-live="polite">${K.monthName(ym)}</h1><button type="button" id="next" aria-label="${w.next}" ${i < Y.months.length - 1 ? '' : 'disabled'}>${K.icon('right', 18).replace('class="ico"', 'class="ico flip"')}</button>${state}</div>
      <div class="gate"><span class="big">${fig(m.left)}</span><span class="what"><b>${w.flows.left}</b><span>${w.flowHow.left}</span></span></div>
      <div class="signs">${['in', 'out', 'saved', 'tax'].map(sign).join('')}</div>
      <section class="sec" aria-labelledby="h-where"><header><h2 id="h-where">${w.whereItWent}</h2><a href="#/flow/out">${he() ? `כל ${cats.length} הקטגוריות` : `All ${cats.length} categories`} ${arrow(14)}</a></header>${cats.slice(0, 5).map(cat).join('')}</section>
      <section class="sec" aria-labelledby="h-lo"><header><h2 id="h-lo">${w.flows.left}, ${he() ? 'חודש אחרי חודש' : 'month by month'}</h2><span style="color:var(--ink-2);font-size:.8125rem">${he() ? 'עמודה פותחת את החודש שלה' : 'A column opens its month'}</span></header>${leftOver()}</section>
    </div>`
  }

  function rowsTable(rows, total) {
    const w = K.w()
    return `<table class="rows"><thead><tr><th>${w.date}</th><th>${w.shop}</th><th class="r">${w.amount}</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="d">${K.day(r.date)}</td><td>${K.bdi(r.shop)}</td><td class="r">${K.money(r.minor)}</td></tr>`).join('')}
      <tr class="t"><td></td><td></td><td class="r">${K.money(total)}</td></tr></tbody></table>`
  }

  function page(parts) {
    const w = K.w(), m = month(), [kind, id] = parts
    const back = (to, label) => `<a class="back" href="${to}">${K.icon('left', 16).replace('class="ico"', 'class="ico flip"')}${label}</a>`
    if (kind === 'flow') {
      let body = ''
      if (id === 'out') {
        const cats = Y.categories(ym), top = cats[0].minor
        body = cats.map((c) => `<a class="cat" href="#/cat/${c.id}"><span class="nm"><span class="dotc" style="background:var(--cat-${c.hue})"></span>${K.bdi(K.name(c))}</span><span class="bar ${c.id === 'none' ? 'unknown' : ''}" style="width:${Math.max(3, Math.round((100 * c.minor) / top))}%"></span><span class="amt">${K.money(c.minor)}</span><span class="arr">${arrow(16)}</span></a>`).join('')
        body = `<div style="margin-top:32px;border-top:2px solid var(--ink)">${body}</div>`
      } else {
        const lines = id === 'in' ? Y.income(ym).map((l) => [K.bdi(l.name), l.minor]) : id === 'saved' ? Y.saved(ym).map((s) => [K.bdi(K.name(s)), s.minor])
          : m.tax === null ? [] : [[he() ? 'מס הכנסה' : 'Income tax', Math.round(m.tax * 0.6845)], [he() ? 'ביטוח לאומי' : 'National insurance', Math.round(m.tax * 0.1824)], [he() ? 'מס בריאות' : 'Health tax', m.tax - Math.round(m.tax * 0.6845) - Math.round(m.tax * 0.1824)]]
        body = `<table class="rows"><tbody>${lines.map(([a, b]) => `<tr><td>${a}</td><td class="r">${K.money(b)}</td></tr>`).join('')}</tbody></table>`
      }
      return `<div class="page view-in">${back('#/', K.monthName(ym))}<h1 class="ptitle">${w.flows[id]}</h1><div class="pbig f-${id}">${m[id] === null ? '—' : fig(m[id])}</div><p class="plead">${w.flowHow[id]}</p>${body}</div>`
    }
    if (kind === 'cat') {
      const c = Y.categories(ym).find((x) => x.id === id)
      const title = K.bdi(K.name(Y.CATS[id]))
      return `<div class="page view-in">${back('#/flow/out', `${w.flows.out} · ${K.monthName(ym)}`)}<h1 class="ptitle">${title}</h1>
        ${c ? `<div class="pbig">${fig(c.minor)}</div><p class="plead">${c.rows.length} ${c.rows.length === 1 ? w.row : w.rows} · ${Math.round((100 * c.minor) / m.out)}% ${w.share}</p>${rowsTable(c.rows, c.minor)}<p><a class="back" href="#/place/transactions">${w.allRows}</a></p>` : `<p class="plead">—</p>`}</div>`
    }
    if (kind === 'next') {
      const rows = Y.categories('2026-10').find((x) => x.id === 'none').rows
      return `<div class="page view-in">${back('#/', w.rail.home)}<h1 class="ptitle">${w.w_uncat}</h1><p class="plead">${w.w_uncatWhy}</p>
        <table class="rows"><thead><tr><th>${w.date}</th><th>${w.shop}</th><th class="r">${w.amount}</th><th class="r">${w.category}</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="d">${K.day(r.date)}</td><td>${K.bdi(r.shop)}</td><td class="r">${K.money(r.minor)}</td><td class="r"><button class="choose" type="button">${he() ? 'בחירה…' : 'Choose…'}</button></td></tr>`).join('')}</tbody></table></div>`
    }
    // A place this prototype does not draw.
    return `<div class="page view-in">${back('#/', w.rail.home)}<h1 class="ptitle">${w.rail[id] || ''}</h1><p class="plead">${he() ? 'המסך הזה אינו חלק מאב־הטיפוס.' : 'This screen is not part of the prototype.'}</p></div>`
  }

  function main() {
    const r = route()
    $('#main').innerHTML = r[0] === '' ? home() : page(r)
    flap = false
    wire()
  }

  function go(d) {
    const j = idx() + d
    if (j < 0 || j >= Y.months.length) return
    ym = Y.months[j].ym
    main()
  }

  function wire() {
    const p = $('#prev'), n = $('#next')
    if (p) p.onclick = () => go(-1)
    if (n) n.onclick = () => go(1)
    const bp = $('#bprev'), bn = $('#bnext'), len = ITEMS().length
    if (bp) bp.onclick = () => { step = (step + len - 1) % len; flap = true; main(); $('#bprev').focus() }
    if (bn) bn.onclick = () => { step = (step + 1) % len; flap = true; main(); $('#bnext').focus() }
    const tip = $('#tip'), w = K.w()
    document.querySelectorAll('.lo .hit').forEach((h) => {
      const j = Number(h.dataset.j), m = Y.months[j]
      h.onclick = () => go(j - idx())
      h.onmousemove = (e) => { tip.innerHTML = `<b>${K.monthName(m.ym)}</b> · ${w.flows.left} ${K.money(m.left, { whole: true })}${m.running ? ' · ' + w.running : ''}`; tip.hidden = false; tip.style.left = Math.min(innerWidth - 260, e.clientX + 14) + 'px'; tip.style.top = e.clientY + 16 + 'px' }
      h.onmouseleave = () => (tip.hidden = true)
    })
  }

  // The palette: places, months and the next steps, filtered as you type.
  let sel = 0, list = []
  function entries() {
    const w = K.w()
    return [
      ...ITEMS().map((it) => ({ label: it.act + ' — ' + it.msg, kind: w.waiting, to: it.to })),
      ...PLACES.concat(DOC).map((k) => ({ label: w.rail[k], kind: he() ? 'מקום' : 'Place', to: k === 'home' ? '#/' : '#/place/' + k })),
      ...['in', 'out', 'saved', 'tax'].map((k) => ({ label: w.flows[k] + ' · ' + K.monthName(ym), kind: he() ? 'נתון' : 'Figure', to: '#/flow/' + k })),
      ...Y.months.slice().reverse().map((m) => ({ label: K.monthName(m.ym), kind: he() ? 'חודש' : 'Month', ym: m.ym })),
    ]
  }
  function renderList(q) {
    const ul = $('#pl')
    list = entries().filter((e) => e.label.toLowerCase().includes(q.toLowerCase()))
    sel = Math.min(sel, Math.max(0, list.length - 1))
    ul.innerHTML = list.length ? list.map((e, j) => `<li role="option" id="o${j}" aria-selected="${j === sel}" data-j="${j}"><bdi>${K.esc(e.label)}</bdi><span class="k">${e.kind}</span></li>`).join('') : `<li class="empty">${he() ? 'אין התאמה. Enter שואל את המודל.' : 'Nothing matches. Enter asks the model.'}</li>`
    $('#pi').setAttribute('aria-activedescendant', list.length ? 'o' + sel : '')
    ul.querySelectorAll('[data-j]').forEach((li) => (li.onclick = () => choose(Number(li.dataset.j))))
  }
  function choose(j) {
    const e = list[j]; if (!e) return
    $('#palette').close()
    if (e.ym) { ym = e.ym; location.hash = '#/'; main() } else location.hash = e.to
  }
  function openPalette() {
    const d = $('#palette'), w = K.w()
    d.innerHTML = `<input id="pi" role="combobox" aria-expanded="true" aria-controls="pl" placeholder="${w.search}" autocomplete="off"><ul id="pl" role="listbox"></ul>`
    sel = 0; d.showModal(); renderList('')
    const i = $('#pi'); i.focus()
    i.oninput = () => { sel = 0; renderList(i.value) }
    i.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(list.length - 1, sel + 1); renderList(i.value) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); renderList(i.value) }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel) }
    }
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return }
    if ($('#palette').open || (e.target.closest && e.target.closest('input'))) return
    if (e.key === '/') { e.preventDefault(); openPalette() }
    else if (e.key === 'Escape' && route()[0] !== '') { e.preventDefault(); history.back() }
    else if (route()[0] === '' && e.key === K.olderKey()) { e.preventDefault(); go(-1) }
    else if (route()[0] === '' && e.key === K.newerKey()) { e.preventDefault(); go(1) }
  })
  addEventListener('hashchange', () => { rail(); main(); $('#main').scrollTop = 0; const h = document.querySelector('.ptitle, h1'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) } })

  function draw() { rail(); cmd(); main() }
  draw()
  window.PROTO = { go, palette: openPalette }
})()
