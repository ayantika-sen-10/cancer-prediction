// script.js - Cancer Cell Detection dashboard
// Everything shown comes from the Flask API:
//   GET  /api/models    -> models, metrics (accuracy, AUC, confusion matrix, ROC), dataset counts
//   GET  /api/dataset   -> all samples, per-class statistics, histograms
//   GET  /api/boundary  -> P(malignant) grid for the decision map
//   POST /predict       -> { radius_mean, texture_mean, model } -> result, consensus, nearest samples
(function () {
    'use strict';

    // Served by Flask the API is same-origin; opened from disk (file://) point at the local server.
    const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:5000' : '';
    const DEFAULT_RADIUS = '17.99';
    const DEFAULT_TEXTURE = '10.38';

    const $ = (id) => document.getElementById(id);
    const state = { info: null, ds: null, pred: null, maps: {} };
    const clsName = (c) => (c === 'M' ? 'Malignant' : 'Benign');
    const pct = (v, d) => (v * 100).toFixed(d === undefined ? 1 : d) + '%';

    function el(tag, props, children) {
        const node = document.createElement(tag);
        Object.keys(props || {}).forEach((k) => {
            if (k === 'text') node.textContent = props[k];
            else if (k === 'class') node.className = props[k];
            else node.setAttribute(k, props[k]);
        });
        (children || []).forEach((c) => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
        return node;
    }
    const setText = (id, text) => { $(id).textContent = text; };

    async function api(path, options) {
        const res = await fetch(API_BASE + path, options);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
        return data;
    }

    function setStatus(kind, text) {
        $('api-dot').className = 'dot ' + (kind || '');
        setText('api-text', text);
    }

    /* ================================================================= overview */
    function renderOverview() {
        const { info } = state;
        const best = info.models.find((m) => m.key === info.best);
        const bestAuc = info.models.reduce((a, b) => (b.auc > a.auc ? b : a));
        const d = info.dataset;

        setText('hero-accuracy', pct(best.accuracy));
        setText('hero-label', `${best.label} - correct on ${pct(best.accuracy)} of ${info.test_rows} samples it had never seen`);
        $('balance-bar').textContent = '';
        [['b', d.benign], ['m', d.malignant]].forEach(([k, n]) => {
            const seg = el('div', { class: k, 'data-tip': `${k === 'b' ? 'Benign' : 'Malignant'}: ${n} of ${d.rows} samples` });
            seg.style.flex = `${n} 1 0`;
            $('balance-bar').appendChild(seg);
        });
        setText('balance-b', `${d.benign} (${pct(d.benign / d.rows)})`);
        setText('balance-m', `${d.malignant} (${pct(d.malignant / d.rows)})`);

        setText('kpi-rows', d.rows);
        setText('kpi-malignant', d.malignant);
        setText('kpi-malignant-hint', `${pct(d.malignant / d.rows)} of samples`);
        setText('kpi-benign', d.benign);
        setText('kpi-benign-hint', `${pct(d.benign / d.rows)} of samples`);
        setText('kpi-auc', bestAuc.auc.toFixed(3));
        setText('kpi-auc-hint', bestAuc.label);
        setText('kpi-test', info.test_rows);
        setText('kpi-test-hint', `${info.train_rows} used for training`);
        setText('steps-rows', d.rows);
        setText('steps-models', info.models.length);
        setText('about-rows', d.rows);
    }

    /* ================================================================= dataset */
    function renderDataset() {
        const { ds } = state;
        const feat = [['radius_mean', 'Radius mean', 'hist-radius'], ['texture_mean', 'Texture mean', 'hist-texture']];
        feat.forEach(([key, title, host]) => {
            const h = ds.histograms[key];
            Charts.histogram($(host), {
                edges: h.edges, xTitle: title,
                series: [
                    { label: 'Benign', counts: h.B, color: 'var(--class-b)' },
                    { label: 'Malignant', counts: h.M, color: 'var(--class-m)' },
                ],
            });
        });

        const body = $('stats-body');
        body.textContent = '';
        feat.forEach(([key, title]) => {
            ['B', 'M'].forEach((c) => {
                const s = ds.stats[c][key];
                body.appendChild(el('tr', {}, [
                    el('td', { text: title }),
                    el('td', {}, [el('span', { class: 'tag ' + c, text: clsName(c) })]),
                    ...[s.n, s.mean, s.median, s.std, s.min, s.q1, s.q3, s.max].map((v) => el('td', { class: 'r', text: String(v) })),
                ]));
            });
        });

        const hb = $('hist-table-body');
        hb.textContent = '';
        feat.forEach(([key, title]) => {
            const h = ds.histograms[key];
            h.B.forEach((_, i) => hb.appendChild(el('tr', {}, [
                el('td', { text: title }),
                el('td', { text: `${Charts.fmtNum(h.edges[i])} to ${Charts.fmtNum(h.edges[i + 1])}` }),
                el('td', { class: 'r', text: String(h.B[i]) }),
                el('td', { class: 'r', text: String(h.M[i]) }),
            ])));
        });

        const r = ds.correlation;
        const strength = Math.abs(r) < 0.3 ? 'weakly' : Math.abs(r) < 0.6 ? 'moderately' : 'strongly';
        setText('corr-note',
            `Malignant samples have a larger mean radius (${ds.stats.M.radius_mean.mean} vs ${ds.stats.B.radius_mean.mean}) ` +
            `and texture (${ds.stats.M.texture_mean.mean} vs ${ds.stats.B.texture_mean.mean}). ` +
            `Radius and texture are ${strength} correlated (r = ${r}).`);
    }

    /* ================================================================= models */
    function mixStyle(colorVar, share) {
        const p = Math.round(Math.min(1, share) * 85);
        return `background: color-mix(in srgb, ${colorVar} ${p}%, var(--surface));color:${p > 48 ? 'var(--accent-ink)' : 'var(--text)'}`;
    }

    function confusionGrid(cm) {
        const [[tn, fp], [fn, tp]] = cm;
        const rowB = tn + fp, rowM = fn + tp;
        const cells = [
            [tn, 'correct benign', '--accent', tn / rowB],
            [fp, 'false alarm', '--text-2', fp / rowB],
            [fn, 'missed malignant', '--text-2', fn / rowM],
            [tp, 'correct malignant', '--accent', tp / rowM],
        ];
        const grid = el('div', { class: 'cm', role: 'table', 'aria-label': 'Confusion matrix' });
        grid.appendChild(el('div'));
        grid.appendChild(el('div', { class: 'h', text: 'Predicted benign' }));
        grid.appendChild(el('div', { class: 'h', text: 'Predicted malignant' }));
        cells.forEach(([n, label, cv, share], i) => {
            if (i % 2 === 0) grid.appendChild(el('div', { class: 'h row', text: i === 0 ? 'Actually benign' : 'Actually malignant' }));
            const cell = el('div', { class: 'cell', style: mixStyle(`var(${cv})`, cv === '--accent' ? share : share * 0.9) }, [
                el('b', { class: 'num', text: String(n) }), el('span', { text: label }),
            ]);
            grid.appendChild(cell);
        });
        return grid;
    }

    function renderModels() {
        const { info } = state;
        const sorted = info.models.slice().sort((a, b) => b.accuracy - a.accuracy);
        Charts.hbars($('accuracy-chart'), {
            max: 1, fmt: (v) => (v === 0 ? '0%' : Math.round(v * 1000) / 10 + '%'),
            items: sorted.map((m) => ({
                label: m.label, value: m.accuracy, best: m.key === info.best,
                tip: `${m.label}\nAccuracy ${pct(m.accuracy)}\nAUC ${m.auc.toFixed(3)}`,
            })),
        });

        const body = $('metrics-body');
        body.textContent = '';
        sorted.forEach((m) => {
            const name = el('td', { text: m.label });
            if (m.key === info.best) name.appendChild(el('span', { class: 'best-badge', text: 'Best accuracy' }));
            body.appendChild(el('tr', { class: m.key === info.best ? 'best' : '' }, [
                name,
                ...[pct(m.accuracy), m.precision_malignant.toFixed(2), m.recall_malignant.toFixed(2), m.f1_malignant.toFixed(2), m.auc.toFixed(3)]
                    .map((t) => el('td', { class: 'r', text: t })),
            ]));
        });
        setText('metrics-note',
            `Measured on ${info.test_rows} held-out samples (${info.train_rows} were used for training; split 80/20, random_state ${info.random_state}). ` +
            'Precision, recall and F1 are for the malignant (M) class.');

        const cards = $('model-cards');
        cards.textContent = '';
        info.models.forEach((m) => {
            const [[tn, fp], [fn, tp]] = m.confusion;
            const rocHost = el('div', { class: 'chart', role: 'img', 'aria-label': `ROC curve for ${m.label}` });
            const card = el('div', { class: 'card model-card' + (m.key === info.best ? ' best' : '') }, [
                el('h3', {}, [m.label, ...(m.key === info.best ? [el('span', { class: 'best-badge', text: 'Best accuracy' })] : [])]),
                el('p', { class: 'sub', text: `${tn + tp} of ${tn + fp + fn + tp} test samples correct` }),
                el('div', { class: 'mc-metrics' }, [
                    ['Accuracy', pct(m.accuracy)], ['Precision', m.precision_malignant.toFixed(2)],
                    ['Recall', m.recall_malignant.toFixed(2)], ['AUC', m.auc.toFixed(3)],
                ].map(([l, v]) => el('div', {}, [el('b', { class: 'num', text: v }), el('span', { text: l })]))),
                el('div', { class: 'sub-title', text: 'Confusion matrix' }),
                confusionGrid(m.confusion),
                el('p', {
                    class: 'muted', style: 'font-size:12.5px;margin-top:8px',
                    text: `Missed ${fn} of ${fn + tp} malignant cells; raised a false alarm on ${fp} of ${tn + fp} benign cells.`
                }),
                el('div', { class: 'sub-title', text: 'ROC curve' }),
                rocHost,
            ]);
            cards.appendChild(card);
            Charts.roc(rocHost, { points: m.roc, auc: m.auc });
        });
    }

    /* ================================================================= detect */
    function percentileBelow(cls, col, value) {
        const vals = state.ds.samples.filter((s) => s[3] === cls).map((s) => s[col]);
        return Math.round((vals.filter((v) => v < value).length / vals.length) * 100);
    }

    function renderResult(data) {
        $('result-empty').classList.add('hidden');
        $('result-loading').classList.add('hidden');
        $('error-message').classList.add('hidden');
        $('result-card').classList.remove('hidden');
        setText('result-sub', `Answered by ${data.label}`);

        const badge = $('result-badge');
        badge.className = 'badge ' + data.diagnosis;
        setText('result-icon', data.diagnosis);
        setText('diagnosis-result', clsName(data.diagnosis));
        setText('confidence-value', data.confidence.toFixed(1) + '%');
        setText('model-used', data.label);
        setText('benign-prob', data.probabilities.B.toFixed(1) + '%');
        setText('malignant-prob', data.probabilities.M.toFixed(1) + '%');
        const bar = $('prob-bar');
        bar.textContent = '';
        [['b', data.probabilities.B], ['m', data.probabilities.M]].forEach(([k, v]) => {
            const seg = el('div', { class: k, 'data-tip': `${k === 'b' ? 'Benign' : 'Malignant'} ${v.toFixed(1)}%` });
            seg.style.flex = `${Math.max(v, 0.5)} 1 0`;
            bar.appendChild(seg);
        });
        setText('diagnosis-text',
            `${data.label} classifies this cell sample as likely ${clsName(data.diagnosis).toLowerCase()}. This is a demonstration result, not a medical diagnosis.`);

        const { radius_mean: r, texture_mean: t } = data.input;
        const S = state.ds.stats;
        const reading = $('reading');
        reading.textContent = '';
        [
            [`Radius ${r}`, 1, r, 'radius_mean'],
            [`Texture ${t}`, 2, t, 'texture_mean'],
        ].forEach(([label, col, v, key]) => {
            reading.appendChild(el('div', {
                text: `${label} is larger than ${percentileBelow('B', col, v)}% of benign and ${percentileBelow('M', col, v)}% of malignant samples ` +
                    `(typical values: benign ${S.B[key].median}, malignant ${S.M[key].median}).`,
            }));
        });

        // Outside the range of the dataset a model is extrapolating: flag it instead of trusting it.
        const out = [];
        [['Radius', 1, r], ['Texture', 2, t]].forEach(([label, col, v]) => {
            const vals = state.ds.samples.map((s) => s[col]);
            const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
            if (v < lo || v > hi) out.push(`${label} ${v} is outside the range seen in the dataset (${lo} to ${hi})`);
        });
        if (out.length) {
            reading.appendChild(el('div', {
                style: 'margin-top:8px;font-weight:600;color:var(--text)',
                text: 'Warning: ' + out.join('; ') + '. No sample backs this up, so the model is guessing - do not trust this result.',
            }));
        }
    }

    function renderConsensus(data) {
        const body = $('consensus-body');
        body.textContent = '';
        data.consensus.forEach((c) => {
            body.appendChild(el('tr', { class: c.model === data.model ? 'best' : '' }, [
                el('td', { text: c.label + (c.model === data.model ? ' (selected)' : '') }),
                el('td', {}, [el('span', { class: 'tag ' + c.diagnosis, text: clsName(c.diagnosis) })]),
                el('td', {}, [(() => {
                    const bar = el('span', { class: 'mini-bar', 'data-tip': `Benign ${c.probabilities.B}% · Malignant ${c.probabilities.M}%` }, [
                        el('i', { class: 'b' }), el('i', { class: 'm' }),
                    ]);
                    bar.children[0].style.width = c.probabilities.B + '%';
                    bar.children[1].style.width = c.probabilities.M + '%';
                    return bar;
                })()]),
                el('td', { class: 'r', text: c.confidence.toFixed(1) + '%' }),
            ]));
        });
        const a = data.agreement;
        let msg;
        if (a.malignant === a.total) msg = `All ${a.total} models agree: malignant.`;
        else if (a.benign === a.total) msg = `All ${a.total} models agree: benign.`;
        else msg = `${a.malignant} of ${a.total} models say malignant, ${a.benign} say benign - the models disagree, so treat this cell as uncertain.`;
        setText('consensus-summary', msg);
    }

    function renderNeighbors(data) {
        const body = $('neighbors-body');
        body.textContent = '';
        data.nearest.forEach((n) => body.appendChild(el('tr', {}, [
            el('td', { class: 'num', text: String(n.id) }),
            el('td', { class: 'r', text: String(n.radius_mean) }),
            el('td', { class: 'r', text: String(n.texture_mean) }),
            el('td', {}, [el('span', { class: 'tag ' + n.diagnosis, text: clsName(n.diagnosis) })]),
            el('td', { class: 'r', text: String(n.distance) }),
        ])));
    }

    function drawScatter() {
        const p = state.pred;
        Charts.scatter($('scatter-chart'), {
            samples: state.ds.samples,
            domainX: state.ds.bounds.radius_mean, domainY: state.ds.bounds.texture_mean,
            user: p ? { x: p.input.radius_mean, y: p.input.texture_mean } : null,
            neighbors: p ? p.nearest : [],
        });
    }

    async function drawMap(modelKey) {
        if (!modelKey) return;
        try {
            if (!state.maps[modelKey]) state.maps[modelKey] = await api(`/api/boundary?model=${encodeURIComponent(modelKey)}&res=60`);
            const map = state.maps[modelKey];
            const p = state.pred;
            setText('map-title', `Decision map - ${map.label}`);
            Charts.decisionMap($('map-canvas'), {
                map, samples: state.ds.samples,
                user: p ? { x: p.input.radius_mean, y: p.input.texture_mean } : null,
            });
            const base = $('map-canvas').__outside ? 'Your cell is outside the plotted range of the dataset. ' :
                (p ? `The ring marks your cell on ${map.label}'s map. ` : `Dots are the ${state.ds.rows} dataset samples. `);
            setText('map-note', base + 'Colour far from any dots is extrapolation: a model can be sure there without any sample to back it up (for example, some models call very small cells malignant).');
        } catch (err) {
            setText('map-note', 'Could not load the decision map: ' + err.message);
        }
    }

    function showError(message) {
        $('result-empty').classList.add('hidden');
        $('result-loading').classList.add('hidden');
        $('result-card').classList.add('hidden');
        setText('error-message', message);
        $('error-message').classList.remove('hidden');
    }

    async function handlePrediction() {
        const rIn = $('radius_mean').value.trim(), tIn = $('texture_mean').value.trim();
        const radius = parseFloat(rIn), texture = parseFloat(tIn);
        if (rIn === '' || tIn === '' || isNaN(radius) || isNaN(texture) || radius < 0 || texture < 0) {
            showError('Enter a radius and a texture that are numbers of 0 or more.');
            return;
        }
        const payload = { radius_mean: radius, texture_mean: texture };
        if ($('model-select').value) payload.model = $('model-select').value;

        $('result-empty').classList.add('hidden');
        $('result-card').classList.add('hidden');
        $('error-message').classList.add('hidden');
        $('result-loading').classList.remove('hidden');
        try {
            const data = await api('/predict', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });
            state.pred = data;
            renderResult(data);
            renderConsensus(data);
            renderNeighbors(data);
            drawScatter();
            drawMap(data.model);
        } catch (err) {
            showError(err instanceof TypeError
                ? 'Cannot reach the prediction backend. Start it with "python backend/app.py" and open http://localhost:5000.'
                : 'Prediction failed: ' + err.message);
        }
    }

    function resetDetect() {
        $('radius_mean').value = DEFAULT_RADIUS;
        $('texture_mean').value = DEFAULT_TEXTURE;
        state.pred = null;
        $('result-card').classList.add('hidden');
        $('error-message').classList.add('hidden');
        $('result-loading').classList.add('hidden');
        $('result-empty').classList.remove('hidden');
        setText('result-sub', 'Waiting for a measurement');
        setText('consensus-summary', 'Run a detection to compare all models on the same cell');
        $('consensus-body').innerHTML = '<tr><td colspan="4" class="muted">No detection yet</td></tr>';
        $('neighbors-body').innerHTML = '<tr><td colspan="5" class="muted">No detection yet</td></tr>';
        drawScatter();
        drawMap($('model-select').value);
    }

    function setupDetect() {
        const { info, ds } = state;
        const select = $('model-select');
        select.textContent = '';
        info.models.forEach((m) => select.appendChild(el('option', {
            value: m.key, text: m.label + (m.key === info.best ? ' (best accuracy)' : ''),
        })));
        select.value = info.best;

        $('prediction-form').addEventListener('submit', (e) => { e.preventDefault(); handlePrediction(); });
        $('reset-btn').addEventListener('click', resetDetect);
        select.addEventListener('change', () => { if (state.pred) handlePrediction(); else drawMap(select.value); });
        [['preset-benign', 'B'], ['preset-malignant', 'M']].forEach(([id, c]) => {
            $(id).addEventListener('click', () => {
                $('radius_mean').value = ds.stats[c].radius_mean.median;
                $('texture_mean').value = ds.stats[c].texture_mean.median;
                handlePrediction();
            });
        });
        drawScatter();
        drawMap(select.value);
    }

    /* ================================================================= shell */
    function setupTheme() {
        let saved = null;
        try { saved = localStorage.getItem('theme'); } catch (e) { /* storage blocked */ }
        if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
        $('theme-toggle').addEventListener('click', () => {
            const cur = document.documentElement.getAttribute('data-theme') ||
                (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            const next = cur === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('theme', next); } catch (e) { /* storage blocked */ }
            const canvas = $('map-canvas');
            if (canvas.__draw) canvas.__draw();   // canvas reads colours once; SVG follows CSS variables
        });
    }

    function setupNav() {
        const links = Array.from(document.querySelectorAll('.sidebar a'));
        const sections = links.map((a) => document.querySelector(a.getAttribute('href')));
        if (!('IntersectionObserver' in window)) return;
        const io = new IntersectionObserver((entries) => {
            entries.forEach((e) => {
                if (e.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
            });
        }, { rootMargin: '-35% 0px -60% 0px' });
        sections.forEach((s) => s && io.observe(s));
    }

    async function init() {
        setupTheme();
        setupNav();
        try {
            const [info, ds] = await Promise.all([api('/api/models'), api('/api/dataset')]);
            state.info = info;
            state.ds = ds;
            setStatus('ok', `API connected · ${info.models.length} models`);
            renderOverview();
            renderDataset();
            renderModels();
            setupDetect();
        } catch (err) {
            setStatus('bad', 'Backend offline');
            setText('hero-label', 'Backend not reachable');
            showError('Cannot reach the prediction backend. Start it with "python backend/app.py" and open http://localhost:5000.');
        }
    }

    // The decision map is a canvas: it must be redrawn once Inter has actually loaded.
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => { const c = $('map-canvas'); if (c && c.__draw) c.__draw(); });
    }
    document.addEventListener('DOMContentLoaded', init);
})();
