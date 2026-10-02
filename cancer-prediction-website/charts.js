// charts.js - small dependency-free charts (SVG + canvas) for the dashboard.
// Colours come from CSS variables so light/dark themes need no chart code.
// Every chart re-draws at its container's real pixel width (ResizeObserver).
(function () {
    'use strict';
    const NS = 'http://www.w3.org/2000/svg';

    /* ------------------------------------------------------------ helpers */
    const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    function svgEl(tag, attrs, parent) {
        const node = document.createElementNS(NS, tag);
        for (const k in attrs || {}) node.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(node);
        return node;
    }
    function svgText(parent, x, y, text, attrs) {
        const t = svgEl('text', Object.assign({ x, y }, attrs || {}), parent);
        t.textContent = text;
        return t;
    }
    const linear = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

    function niceTicks(min, max, target) {
        const span = max - min || 1;
        const raw = span / Math.max(1, target);
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
        const out = [];
        for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
        return out;
    }
    const fmtNum = (v) => (Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v * 100) / 100) : v.toFixed(1));

    // vertical bar: square at the baseline, r-rounded at the top
    function barPath(x, y, w, h, r) {
        r = Math.min(r, w / 2, h);
        return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
    }
    // horizontal bar: square at the baseline (left), r-rounded at the right end
    function hBarPath(x, y, w, h, r) {
        r = Math.min(r, h / 2, w);
        return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
    }

    /* ------------------------------------------------------------ tooltip */
    function tipNode() { return document.getElementById('tooltip'); }
    function showTip(text, ev) {
        const t = tipNode();
        if (!t) return;
        t.textContent = text;
        t.classList.add('on');
        const pad = 14;
        const w = t.offsetWidth, h = t.offsetHeight;
        let x = ev.clientX + pad, y = ev.clientY + pad;
        if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
        if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
        t.style.left = Math.max(8, x) + 'px';
        t.style.top = Math.max(8, y) + 'px';
    }
    function hideTip() { const t = tipNode(); if (t) t.classList.remove('on'); }
    function bindTips(root) {
        if (root.__tips) return;
        root.__tips = true;
        const handler = (e) => {
            const hit = e.target.closest && e.target.closest('[data-tip]');
            if (hit && root.contains(hit)) showTip(hit.getAttribute('data-tip'), e);
            else hideTip();
        };
        root.addEventListener('mousemove', handler);
        root.addEventListener('click', handler);
        root.addEventListener('mouseleave', hideTip);
    }

    /* ------------------------------------------------------------ responsive mount */
    function mount(host, draw) {
        host.__draw = draw;
        if (!host.__ro && 'ResizeObserver' in window) {
            host.__ro = new ResizeObserver(() => {
                const w = Math.floor(host.clientWidth);
                if (w && w !== host.__w) redraw(host);
            });
            host.__ro.observe(host);
        }
        bindTips(host);
        redraw(host);
    }
    function redraw(host) {
        if (!host.__draw) return;
        const w = Math.max(240, Math.floor(host.clientWidth) || 320);
        host.__w = w;
        host.textContent = '';
        host.__draw(w);
    }

    function baseSvg(host, w, h) {
        return svgEl('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, preserveAspectRatio: 'xMidYMid meet' }, host);
    }

    function axes(svg, m, w, h, xs, ys, xTicks, yTicks, o) {
        const { fmtX = fmtNum, fmtY = fmtNum, xTitle, yTitle } = o || {};
        yTicks.forEach((v) => {
            svgEl('line', { x1: m.l, x2: w - m.r, y1: ys(v), y2: ys(v), class: 'grid-line' }, svg);
            svgText(svg, m.l - 8, ys(v) + 4, fmtY(v), { 'text-anchor': 'end' });
        });
        xTicks.forEach((v) => {
            svgEl('line', { x1: xs(v), x2: xs(v), y1: m.t, y2: h - m.b, class: 'grid-line' }, svg);
            svgText(svg, xs(v), h - m.b + 16, fmtX(v), { 'text-anchor': 'middle' });
        });
        svgEl('line', { x1: m.l, x2: w - m.r, y1: h - m.b, y2: h - m.b, class: 'axis-line' }, svg);
        if (xTitle) svgText(svg, (m.l + w - m.r) / 2, h - 4, xTitle, { 'text-anchor': 'middle', class: 'axis-title' });
        if (yTitle) {
            const t = svgText(svg, 12, (m.t + h - m.b) / 2, yTitle, { 'text-anchor': 'middle', class: 'axis-title' });
            t.setAttribute('transform', `rotate(-90 12 ${(m.t + h - m.b) / 2})`);
        }
    }

    /* ------------------------------------------------------------ scatter */
    // opts: samples [[id,x,y,cls,split]], domainX, domainY, user {x,y}|null, neighbors [{radius_mean,texture_mean,id}]
    function scatter(host, opts) {
        mount(host, (w) => {
            const h = Math.round(Math.max(270, Math.min(440, w * 0.72)));
            const m = { l: 46, r: 14, t: 12, b: 42 };
            let [x0, x1] = opts.domainX, [y0, y1] = opts.domainY;
            if (opts.user) {
                x0 = Math.min(x0, Math.floor(opts.user.x) - 1); x1 = Math.max(x1, Math.ceil(opts.user.x) + 1);
                y0 = Math.min(y0, Math.floor(opts.user.y) - 1); y1 = Math.max(y1, Math.ceil(opts.user.y) + 1);
            }
            const xs = linear(x0, x1, m.l, w - m.r), ys = linear(y0, y1, h - m.b, m.t);
            const svg = baseSvg(host, w, h);
            axes(svg, m, w, h, xs, ys, niceTicks(x0, x1, w < 420 ? 5 : 8), niceTicks(y0, y1, 6), { xTitle: 'Radius mean', yTitle: 'Texture mean' });

            const dots = svgEl('g', {}, svg);
            opts.samples.forEach((s) => {
                svgEl('circle', {
                    cx: xs(s[1]), cy: ys(s[2]), r: 3.4,
                    style: `fill:var(--class-${s[3] === 'M' ? 'm' : 'b'});fill-opacity:.55`,
                    'data-tip': `Sample ${s[0]} · ${s[3] === 'M' ? 'Malignant' : 'Benign'}\nRadius ${s[1]} · Texture ${s[2]}`,
                }, dots);
            });

            if (opts.user) {
                const ux = xs(opts.user.x), uy = ys(opts.user.y);
                (opts.neighbors || []).forEach((n) => {
                    svgEl('line', { x1: ux, y1: uy, x2: xs(n.radius_mean), y2: ys(n.texture_mean), style: 'stroke:var(--text-2);stroke-width:1;stroke-opacity:.55' }, svg);
                });
                (opts.neighbors || []).forEach((n) => {
                    svgEl('circle', {
                        cx: xs(n.radius_mean), cy: ys(n.texture_mean), r: 6.5,
                        style: 'fill:none;stroke:var(--text-2);stroke-width:2',
                        'data-tip': `Nearest · sample ${n.id} · ${n.diagnosis === 'M' ? 'Malignant' : 'Benign'}\nRadius ${n.radius_mean} · Texture ${n.texture_mean}\nDistance ${n.distance}`,
                    }, svg);
                });
                svgEl('circle', { cx: ux, cy: uy, r: 10, style: 'fill:var(--surface);fill-opacity:.85' }, svg);
                svgEl('circle', {
                    cx: ux, cy: uy, r: 8, style: 'fill:none;stroke:var(--text);stroke-width:3',
                    'data-tip': `Your cell\nRadius ${opts.user.x} · Texture ${opts.user.y}`,
                }, svg);
                svgEl('circle', { cx: ux, cy: uy, r: 2.6, style: 'fill:var(--text)' }, svg);
                const right = ux < w - 90;
                const lbl = svgText(svg, right ? ux + 14 : ux - 14, uy - 12, 'Your cell', { 'text-anchor': right ? 'start' : 'end', class: 'val-label' });
                lbl.setAttribute('style', 'paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round');
            }
        });
    }

    /* ------------------------------------------------------------ histogram (grouped bars) */
    // opts: edges [n+1], series [{label, counts[n], color:'var(--class-b)'}], xTitle
    function histogram(host, opts) {
        mount(host, (w) => {
            const h = Math.round(Math.max(230, Math.min(320, w * 0.55)));
            const m = { l: 40, r: 10, t: 12, b: 44 };
            const n = opts.edges.length - 1;
            const maxC = Math.max(...opts.series.flatMap((s) => s.counts));
            const yTicks = niceTicks(0, maxC * 1.05, 5);
            const yMax = yTicks[yTicks.length - 1];
            const ys = linear(0, yMax, h - m.b, m.t);
            const colW = (w - m.l - m.r) / n;
            const svg = baseSvg(host, w, h);
            yTicks.forEach((v) => {
                svgEl('line', { x1: m.l, x2: w - m.r, y1: ys(v), y2: ys(v), class: 'grid-line' }, svg);
                svgText(svg, m.l - 8, ys(v) + 4, String(v), { 'text-anchor': 'end' });
            });
            svgEl('line', { x1: m.l, x2: w - m.r, y1: h - m.b, y2: h - m.b, class: 'axis-line' }, svg);
            const barW = Math.max(3, Math.min(24, (colW - 8) / opts.series.length - 2));
            const groupW = barW * opts.series.length + 2 * (opts.series.length - 1);
            const every = Math.ceil(n / Math.max(2, Math.floor((w - m.l - m.r) / 54)));
            for (let i = 0; i < n; i++) {
                const gx = m.l + colW * i + (colW - groupW) / 2;
                opts.series.forEach((s, j) => {
                    const c = s.counts[i];
                    if (c > 0) svgEl('path', { d: barPath(gx + j * (barW + 2), ys(c), barW, h - m.b - ys(c), 4), style: `fill:${s.color}` }, svg);
                });
                const lo = opts.edges[i], hi = opts.edges[i + 1];
                svgEl('rect', {
                    x: m.l + colW * i, y: m.t, width: colW, height: h - m.t - m.b, fill: 'transparent',
                    'data-tip': `${opts.xTitle} ${fmtNum(lo)} to ${fmtNum(hi)}\n` + opts.series.map((s) => `${s.label}: ${s.counts[i]}`).join('\n'),
                }, svg);
                if (i % every === 0) svgText(svg, m.l + colW * i, h - m.b + 16, fmtNum(lo), { 'text-anchor': 'middle' });
            }
            svgText(svg, (m.l + w - m.r) / 2, h - 4, opts.xTitle, { 'text-anchor': 'middle', class: 'axis-title' });
        });
    }

    /* ------------------------------------------------------------ horizontal bars */
    // opts: items [{label, value, best, tip}], max, fmt
    function hbars(host, opts) {
        mount(host, (w) => {
            const rowH = 36, barH = 20;
            const m = { l: Math.min(w * 0.42, Math.max(...opts.items.map((i) => i.label.length)) * 7 + 12), r: 54, t: 6, b: 26 };
            const h = m.t + rowH * opts.items.length + m.b;
            const max = opts.max || 1;
            const xs = linear(0, max, m.l, w - m.r);
            const svg = baseSvg(host, w, h);
            niceTicks(0, max, 4).forEach((v) => {
                svgEl('line', { x1: xs(v), x2: xs(v), y1: m.t, y2: h - m.b, class: 'grid-line' }, svg);
                svgText(svg, xs(v), h - m.b + 16, (opts.fmt || fmtNum)(v), { 'text-anchor': 'middle' });
            });
            svgEl('line', { x1: m.l, x2: m.l, y1: m.t, y2: h - m.b, class: 'axis-line' }, svg);
            opts.items.forEach((it, i) => {
                const y = m.t + rowH * i + (rowH - barH) / 2;
                svgText(svg, m.l - 10, y + barH / 2 + 4, it.label, { 'text-anchor': 'end', style: 'fill:var(--text-2);font-size:13px' });
                const bw = Math.max(2, xs(it.value) - m.l);
                svgEl('path', { d: hBarPath(m.l, y, bw, barH, 4), style: `fill:${it.best ? 'var(--accent)' : 'var(--bar)'}` }, svg);
                svgText(svg, m.l + bw + 6, y + barH / 2 + 4, (opts.fmt || fmtNum)(it.value), { class: 'val-label' });
                svgEl('rect', { x: 0, y: m.t + rowH * i, width: w, height: rowH, fill: 'transparent', 'data-tip': it.tip || `${it.label}: ${(opts.fmt || fmtNum)(it.value)}` }, svg);
            });
        });
    }

    /* ------------------------------------------------------------ ROC curve */
    // opts: points [[fpr,tpr]], auc
    function roc(host, opts) {
        mount(host, (w) => {
            const h = Math.round(Math.max(190, Math.min(250, w * 0.72)));
            const m = { l: 36, r: 10, t: 8, b: 34 };
            const xs = linear(0, 1, m.l, w - m.r), ys = linear(0, 1, h - m.b, m.t);
            const svg = baseSvg(host, w, h);
            axes(svg, m, w, h, xs, ys, [0, 0.5, 1], [0, 0.5, 1], { xTitle: 'False positive rate', yTitle: 'True positive rate' });
            svgEl('line', { x1: xs(0), y1: ys(0), x2: xs(1), y2: ys(1), style: 'stroke:var(--text-3);stroke-width:1;stroke-opacity:.6' }, svg);
            const pts = opts.points.map((p) => `${xs(p[0])},${ys(p[1])}`);
            svgEl('path', { d: `M${xs(0)},${ys(0)} L${pts.join(' L')} L${xs(1)},${ys(0)} Z`, style: 'fill:var(--accent);fill-opacity:.1;stroke:none' }, svg);
            svgEl('path', { d: `M${pts.join(' L')}`, style: 'fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round' }, svg);
            opts.points.forEach((p) => svgEl('circle', {
                cx: xs(p[0]), cy: ys(p[1]), r: 7, fill: 'transparent',
                'data-tip': `False positive rate ${p[0].toFixed(2)}\nTrue positive rate ${p[1].toFixed(2)}`,
            }, svg));
            const lbl = svgText(svg, xs(0.97), ys(0.12), `AUC ${opts.auc.toFixed(3)}`, { 'text-anchor': 'end', class: 'val-label' });
            lbl.setAttribute('style', 'paint-order:stroke;stroke:var(--surface);stroke-width:4px');
        });
    }

    /* ------------------------------------------------------------ decision map (canvas) */
    const hex = (c) => { const v = c.replace('#', ''); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };

    // opts: map {p_malignant[][], x:[x0,x1], y:[y0,y1]}, samples, user, neighbors
    function decisionMap(canvas, opts) {
        const draw = () => {
            const cssW = Math.max(260, Math.floor(canvas.parentElement.clientWidth));
            const cssH = Math.round(cssW * 0.72);
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
            canvas.style.height = cssH + 'px';
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const m = { l: 44, r: 10, t: 10, b: 38 };
            const pw = cssW - m.l - m.r, ph = cssH - m.t - m.b;
            const [x0, x1] = opts.map.x, [y0, y1] = opts.map.y;
            const xs = linear(x0, x1, m.l, m.l + pw), ys = linear(y0, y1, m.t + ph, m.t);

            ctx.fillStyle = cssVar('--surface'); ctx.fillRect(0, 0, cssW, cssH);

            // P(malignant) grid -> smooth image: blue <- neutral -> orange
            const grid = opts.map.p_malignant, res = grid.length;
            const off = document.createElement('canvas'); off.width = res; off.height = res;
            const octx = off.getContext('2d'); const img = octx.createImageData(res, res);
            const cB = hex(cssVar('--class-b')), cM = hex(cssVar('--class-m')), cN = hex(cssVar('--neutral'));
            for (let r = 0; r < res; r++) {
                for (let c = 0; c < res; c++) {
                    const p = grid[r][c];
                    const t = Math.min(1, Math.abs(p - 0.5) * 2);
                    const target = p >= 0.5 ? cM : cB;
                    const k = Math.pow(t, 0.85) * 0.8;
                    const o = ((res - 1 - r) * res + c) * 4;   // row 0 = lowest texture = bottom
                    for (let i = 0; i < 3; i++) img.data[o + i] = Math.round(cN[i] + (target[i] - cN[i]) * k);
                    img.data[o + 3] = 255;
                }
            }
            octx.putImageData(img, 0, 0);
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(off, m.l, m.t, pw, ph);

            // axes
            ctx.font = '500 12px ' + getComputedStyle(document.body).fontFamily;
            ctx.fillStyle = cssVar('--text-3'); ctx.strokeStyle = cssVar('--border'); ctx.lineWidth = 1;
            ctx.textAlign = 'center';
            niceTicks(x0, x1, cssW < 420 ? 5 : 8).forEach((v) => ctx.fillText(fmtNum(v), xs(v), m.t + ph + 15));
            ctx.textAlign = 'right';
            niceTicks(y0, y1, 6).forEach((v) => ctx.fillText(fmtNum(v), m.l - 7, ys(v) + 4));
            ctx.strokeRect(m.l + 0.5, m.t + 0.5, pw, ph);
            ctx.fillStyle = cssVar('--text-2'); ctx.textAlign = 'center';
            ctx.fillText('Radius mean', m.l + pw / 2, cssH - 6);
            ctx.save(); ctx.translate(12, m.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('Texture mean', 0, 0); ctx.restore();

            // samples
            const pts = [];
            opts.samples.forEach((s) => {
                const px = xs(s[1]), py = ys(s[2]);
                ctx.beginPath(); ctx.arc(px, py, 2.6, 0, Math.PI * 2);
                ctx.fillStyle = cssVar(s[3] === 'M' ? '--class-m' : '--class-b');
                ctx.globalAlpha = 0.9; ctx.fill();
                ctx.globalAlpha = 1; ctx.strokeStyle = cssVar('--surface'); ctx.lineWidth = 1; ctx.stroke();
                pts.push({ px, py, s });
            });

            if (opts.user) {
                const ux = xs(opts.user.x), uy = ys(opts.user.y);
                const inside = ux >= m.l && ux <= m.l + pw && uy >= m.t && uy <= m.t + ph;
                if (inside) {
                    ctx.beginPath(); ctx.arc(ux, uy, 9, 0, Math.PI * 2); ctx.fillStyle = cssVar('--surface'); ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
                    ctx.beginPath(); ctx.arc(ux, uy, 7, 0, Math.PI * 2); ctx.strokeStyle = cssVar('--text'); ctx.lineWidth = 3; ctx.stroke();
                    ctx.beginPath(); ctx.arc(ux, uy, 2.4, 0, Math.PI * 2); ctx.fillStyle = cssVar('--text'); ctx.fill();
                }
                canvas.__outside = !inside;
            } else canvas.__outside = false;
            canvas.__pts = pts; canvas.__opts = opts;
        };
        canvas.__draw = draw;
        if (!canvas.__bound) {
            canvas.__bound = true;
            if ('ResizeObserver' in window) new ResizeObserver(() => canvas.__draw()).observe(canvas.parentElement);
            const find = (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left, y = e.clientY - rect.top;
                let best = null, bd = 10;
                (canvas.__pts || []).forEach((p) => { const d = Math.hypot(p.px - x, p.py - y); if (d < bd) { bd = d; best = p; } });
                if (best) showTip(`Sample ${best.s[0]} · ${best.s[3] === 'M' ? 'Malignant' : 'Benign'}\nRadius ${best.s[1]} · Texture ${best.s[2]}`, e);
                else hideTip();
            };
            canvas.addEventListener('mousemove', find);
            canvas.addEventListener('mouseleave', hideTip);
        }
        draw();
    }

    window.Charts = { scatter, histogram, hbars, roc, decisionMap, redraw, niceTicks, fmtNum, hideTip };
})();
