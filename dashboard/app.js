// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function, the same arithmetic lib/model.ts runs: the category's comparable median
  // multiple, a fitted size elasticity, and two shrunken bucket terms. The page recomputes a row's number
  // from the snapshot figures and compares it with the one board.json carries, so the code and the board
  // are visibly the same arithmetic.
  function bucketOf(buckets, v) {
    for (var i = 0; i < buckets.length; i++) {
      // A null edge is open ended, not zero: comparing against null coerced it to 0, so the first and last
      // buckets never matched and the page recomputed the row with a multiplier of 1 instead.
      var lo = buckets[i].lo === null || buckets[i].lo === undefined ? -Infinity : buckets[i].lo;
      var hi = buckets[i].hi === null || buckets[i].hi === undefined ? Infinity : buckets[i].hi;
      if (v >= lo && v < hi) return buckets[i].multiplier;
    }
    return 1;
  }
  function impliedOf(row, model, cal) {
    var ratio = row.category_ratio;
    var size = Math.min(2.5, Math.max(0.25, Math.exp(model.size_elasticity * Math.log(row.tvl_usd / model.median_tvl))));
    var growth = bucketOf(cal.growth, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d);
    var age = row.age_days === null || row.age_days === undefined ? 1 : bucketOf(cal.age, row.age_days);
    return Math.max(1, Math.round(row.tvl_usd * ratio * size * growth * age));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is not re-derived in the page: board.json and data.js carry the same strings, so what
  // the reader sees in the detail view is byte for byte the plan the board was built from. The page only
  // splits each step into its action and its cost/time tail for layout.
  function farmSteps(p) {
    return (p.farm_steps || []).slice();
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'ratio') { av = a.category_ratio; bv = b.category_ratio; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The radar then goes past it: ' + DATA.early_size + ' further pre-token protocols are ranked, ' + DATA.early_above_floor + ' of them at or above that same $' + Math.round(DATA.floor_usd / 1e6) + 'M floor because the watchlist rule passed them over, the rest below it. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Extra rows beyond the watchlist' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: '...of those at or above the floor' }), el('b', { text: String(DATA.early_above_floor) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function modelStrip() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var biggest = cal.categories.filter(function (c) { return !c.fallback; }).slice(0, 3)
      .map(function (c) { return c.category + ' ' + c.ratio.toFixed(2); }).join(', ');
    return el('div', { class: 'strip' },
      el('div', { class: 'strip-item' },
        el('span', { class: 'strip-k', text: 'The multiple' }),
        el('p', { text: 'Each row\u2019s TVL is multiplied by its category\u2019s comparable median market-cap-to-TVL, taken over the ' + cal.sample_n + ' snapshot protocols that record a token. ' + cal.categories_with_sample + ' of ' + cal.categories.length + ' categories have ' + m.min_category_n + ' or more peers (highest: ' + biggest + '); the rest use the universe median ' + m.universe_ratio + ', marked *.' })
      ),
      el('div', { class: 'strip-item' },
        el('span', { class: 'strip-k', text: 'The size correction' }),
        el('p', { text: 'Bigger books carry a lower multiple: the elasticity fitted within categories is ' + m.size_elasticity + ', so ten times the median TVL of ' + fmtUsd(m.median_tvl) + ' keeps about ' + Math.round(Math.exp(m.size_elasticity * Math.log(10)) * 100) + '% of the multiple.' })
      ),
      el('div', { class: 'strip-item' },
        el('span', { class: 'strip-k', text: 'Growth and age' }),
        el('p', { text: 'Both are fitted on what the first two terms leave over, so neither double-counts them, and both are clamped to 0.8\u20131.3. Growth is close to neutral here because it tests as having no measurable effect on the multiple; age reverses, favouring the older protocol.' })
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', title: r.category_ratio_fallback ? 'universe median, category too thin' : 'category median, n=' + r.category_ratio_n, text: r.category_ratio.toFixed(2) + (r.category_ratio_fallback ? '*' : '') }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('ratio', 'Mult'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      ),
      el('p', { class: 'legend sub' }, 'Mult is the category\u2019s comparable median market-cap-to-TVL. A number with * is the whole-universe median of ' + DATA.model.universe_ratio + ', used because that category has fewer than ' + DATA.model.min_category_n + ' protocols that record a token. Implied value = TVL \u00d7 Mult \u00d7 size \u00d7 growth \u00d7 age; the panel below the table shows the fitted tables.')
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var cats = cal.categories.slice(0, 8);
    var catRows = cats.map(function (c) {
      return el('tr', null,
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: String(c.n) }),
        el('td', { class: 'num', text: c.ratio.toFixed(3) }),
        el('td', null, el('span', { class: 'sub', text: c.fallback ? 'falls back to the universe median' : 'own median, n >= ' + m.min_category_n }))
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row from the snapshot figures. Its constants are fitted from the snapshot at run time, in buildCalibration: no protocol is named and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category_ratio x size_multiplier x growth_multiplier x age_multiplier )'
      ),
      el('p', { class: 'sub', text: 'The multiple is the category\u2019s comparable median market-cap-to-TVL, taken over the ' + cal.sample_n + ' snapshot protocols that already record a token, and used only when that category has at least ' + m.min_category_n + ' such protocols (' + cal.categories_with_sample + ' of ' + cal.categories.length + ' categories do); every other category uses the whole-universe median of ' + m.universe_ratio + '.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'compact' },
          el('caption', { class: 'sub', text: 'The category multiples this board used, widest sample first.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Token peers' }),
            el('th', { scope: 'col', text: 'Median mcap/TVL' }),
            el('th', { scope: 'col', text: 'Where it comes from' })
          )),
          el('tbody', null, catRows)
        )
      ),
      el('p', { class: 'sub', text: 'Size: a protocol ten times the median TVL of ' + fmtUsd(m.median_tvl) + ' carries about ' + Math.round(Math.exp(m.size_elasticity * Math.log(10)) * 100) + '% of the multiple, the within-category elasticity fitted here (' + m.size_elasticity + ', t ' + m.size_t + '). Growth and age are fitted on what the category and size terms leave over, never on raw ratios: each recorded-token protocol\u2019s residual is its own multiple divided by what those two terms predict, and a bucket takes the median residual, shrunk toward 1 by n/(n+' + m.shrink_k + ') and clamped to 0.8\u20131.3. Growth cuts at ' + cal.growth_edges.join(', ') + ' per cent, age at ' + cal.age_cut_days + ' days.' }),
      el('p', { class: 'sub', text: 'The honest part: seven-day growth has no measurable effect on the multiple here (tested against a TVL back-adjusted by its own seven-day change, t = -0.33, R\u00b2 = 0.0009), so its term is fitted on residuals and kept inside a narrow band where it cannot decide a row. The age term reverses once the category mix is removed: protocols listed over two years carry a slightly higher residual than younger ones. Both are shown rather than asserted. Implied value estimates what a token would be worth if the record held; it is not a promise that one is issued.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (n=' + row.category_ratio_n + (row.category_ratio_fallback ? ', universe median' : ', own median') + ')' }), el('b', { class: 'num', text: row.category_ratio.toFixed(3) })),
        el('div', null, el('span', { text: 'Size multiplier' }), el('b', { class: 'num', text: String(row.size_multiplier) })),
        el('div', null, el('span', { text: 'Seven-day growth ' + fmtPct(row.change_7d) }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token ' + fmtAge(row.age_days) }), el('b', { class: 'num', text: String(row.age_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': one function scores every protocol. This page recomputes the row from the multipliers and the snapshot figures as ' + fmtUsd(impliedOf(row, DATA.model, DATA.calibration)) + (impliedOf(row, DATA.model, DATA.calibration) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board, so the page and the data disagree.') + ' An estimate of what a token would be worth if the record held, not a price and not a promise of issue.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') shell.appendChild(modelStrip());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
