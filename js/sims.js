/* 章内埋め込み用シミュレーションウィジェット(スイッチング電源制御版)
 * セミナー資料「基礎から理解するスイッチング電源制御系設計」に準拠:
 *   降圧コンバータ例:Vi = 12 V, Vo = 3.3 V, L = 10 µH, C = 100 µF,
 *   rC(ESR) = 45 mΩ → fn ≒ 5.03 kHz, fesr ≒ 35.4 kHz, ζ ≒ 0.26
 * 使い方(plot.js を先に読み込むこと):
 *   SimWidgets.conv(el, {})      … 降圧/昇圧コンバータのスイッチング波形(第2・3章)
 *   SimWidgets.series(el, {})    … フィードバックと無限等比級数(第4章)
 *   SimWidgets.bodezpk(el, {})   … 極・零点とボード線図(第5章)
 *   SimWidgets.nyq(el, {})       … ナイキスト線図と安定性(第5章)
 *   SimWidgets.fbstep(el, {})    … P/PI/PID制御のステップ応答(第6章)
 *   SimWidgets.gvd(el, {})       … プラント Gvd(s) の周波数特性(第7章)
 *   SimWidgets.openload(el, {})  … フィードバック無しの負荷過渡応答(第8章)
 *   SimWidgets.loopdesign(el, {})… ループ整形による補償器設計(第9章)
 *   SimWidgets.closedtrans(el, {})… 閉ループの負荷過渡応答(第9章)
 *   SimWidgets.rhpz(el, {})      … 右半平面零点の影響(第10章)
 *   SimWidgets.cmc(el, {})       … 電流ループによるプラント特性の変化(第10章)
 */
"use strict";

const SimWidgets = (() => {

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function slider(labelHtml, min, max, stepv, value, fmt) {
    const row = el(`<div class="slider-group">
      <label><span>${labelHtml}</span><span class="value"></span></label>
      <input type="range" min="${min}" max="${max}" step="${stepv}" value="${value}">
    </div>`);
    const input = row.querySelector("input");
    const valEl = row.querySelector(".value");
    const obj = {
      row,
      get: () => parseFloat(input.value),
      set: (v) => { input.value = v; obj.refresh(); },
      refresh: () => { valEl.textContent = fmt(parseFloat(input.value)); },
      onInput: (cb) => input.addEventListener("input", () => { obj.refresh(); cb(); }),
      show: (v) => { row.style.display = v ? "" : "none"; },
    };
    obj.refresh();
    return obj;
  }

  /* 対数スライダー:内部値は log10,表示は実値 */
  function logSlider(labelHtml, expMin, expMax, expValue, fmt) {
    const s = slider(labelHtml, expMin, expMax, 0.02, expValue, (v) => fmt(Math.pow(10, v)));
    return {
      row: s.row,
      get: () => Math.pow(10, s.get()),
      set: (v) => s.set(Math.log10(v)),
      onInput: s.onInput,
      show: s.show,
      refresh: s.refresh,
    };
  }

  function frame(container, title) {
    container.classList.add("sim-embed");
    container.innerHTML = "";
    container.append(el(`<div class="sim-embed-header"><span class="badge sim">対話型</span> ${title}</div>`));
    const layout = el(`<div class="sim-layout"></div>`);
    const panel = el(`<div class="control-panel"></div>`);
    const plotArea = el(`<div></div>`);
    layout.append(panel, plotArea);
    container.append(layout);
    return { panel, plotArea };
  }

  function metricsBar(defs) {
    const bar = el(`<div class="metrics"></div>`);
    const cells = {};
    for (const [key, label] of defs) {
      const cell = el(`<div class="metric">${label}<br><span class="metric-value">–</span></div>`);
      cells[key] = cell.querySelector(".metric-value");
      bar.append(cell);
    }
    return { bar, cells };
  }

  function makeCanvas(h) {
    return el(`<canvas class="plot" data-h="${h}"></canvas>`);
  }

  function selectRow(labelText, options) {
    const wrap = el(`<div style="margin-bottom:0.9rem;">
      <div style="font-size:0.88rem;margin-bottom:0.2rem;">${labelText}</div>
      <select></select></div>`);
    const sel = wrap.querySelector("select");
    for (const [v, t] of options) {
      const o = document.createElement("option");
      o.value = v; o.textContent = t;
      sel.append(o);
    }
    return { row: wrap, sel, get: () => sel.value, onChange: (cb) => sel.addEventListener("change", cb) };
  }

  function checkbox(labelText, checked) {
    const wrap = el(`<div class="checkbox-row"><label><input type="checkbox" ${checked ? "checked" : ""}> ${labelText}</label></div>`);
    const input = wrap.querySelector("input");
    return { row: wrap, get: () => input.checked, onChange: (cb) => input.addEventListener("change", cb) };
  }

  /* ---------- 数値計算ヘルパー ---------- */

  /** RK4 で x' = deriv(x, t) を積分する */
  function simODE(deriv, x0, tEnd, N) {
    const dt = tEnd / N;
    const addv = (x, k, h) => x.map((v, j) => v + h * k[j]);
    let x = x0.slice();
    const ts = [0], xs = [x.slice()];
    for (let i = 1; i <= N; i++) {
      const t = (i - 1) * dt;
      const k1 = deriv(x, t);
      const k2 = deriv(addv(x, k1, dt / 2), t + dt / 2);
      const k3 = deriv(addv(x, k2, dt / 2), t + dt / 2);
      const k4 = deriv(addv(x, k3, dt), t + dt);
      x = x.map((v, j) => v + dt / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
      ts.push(i * dt);
      xs.push(x.slice());
    }
    return { ts, xs };
  }

  const col = (xs, j) => xs.map((r) => r[j]);
  const fmtN = (v, d = 2) => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(d);

  /** 周波数の表示: 5030 → "5.03k" */
  function fmtHz(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 2) + "k";
    if (v >= 100) return v.toFixed(0);
    return v.toFixed(1);
  }

  /* 複素数 [re, im] */
  const C = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
    mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
    div: (a, b) => {
      const d = b[0] * b[0] + b[1] * b[1];
      return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
    },
    abs: (a) => Math.hypot(a[0], a[1]),
    scale: (a, k) => [a[0] * k, a[1] * k],
  };

  /** 連続な位相 [deg] を返す(アンラップ付き) */
  function phaseUnwrap(resp) {
    const ph = [];
    let prev = 0, offset = 0;
    for (let i = 0; i < resp.length; i++) {
      let p = Math.atan2(resp[i][1], resp[i][0]) * 180 / Math.PI;
      if (i > 0) {
        while (p + offset - prev > 180) offset -= 360;
        while (p + offset - prev < -180) offset += 360;
      }
      prev = p + offset;
      ph.push(prev);
    }
    return ph;
  }

  /** 対数周波数グリッド [Hz] */
  function freqGrid(f0, f1, N = 400) {
    const fs = [];
    const l0 = Math.log10(f0), l1 = Math.log10(f1);
    for (let i = 0; i <= N; i++) fs.push(Math.pow(10, l0 + (l1 - l0) * i / N));
    return fs;
  }

  /** ゲイン交差(0dB)・位相交差(−180deg)と余裕を求める */
  function margins(fs, gainDB, phaseDeg) {
    let fgc = null, pm = null, fpc = null, gm = null;
    for (let i = 1; i < fs.length; i++) {
      if (fgc === null && gainDB[i - 1] > 0 && gainDB[i] <= 0) {
        const r = gainDB[i - 1] / (gainDB[i - 1] - gainDB[i]);
        fgc = fs[i - 1] * Math.pow(fs[i] / fs[i - 1], r);
        const ph = phaseDeg[i - 1] + (phaseDeg[i] - phaseDeg[i - 1]) * r;
        pm = 180 + ph;
      }
      if (fpc === null && phaseDeg[i - 1] > -180 && phaseDeg[i] <= -180) {
        const r = (phaseDeg[i - 1] + 180) / (phaseDeg[i - 1] - phaseDeg[i]);
        fpc = fs[i - 1] * Math.pow(fs[i] / fs[i - 1], r);
        const g = gainDB[i - 1] + (gainDB[i] - gainDB[i - 1]) * r;
        gm = -g;
      }
    }
    return { fgc, pm, fpc, gm };
  }

  const COL = { c1: "#1a5fb4", c2: "#c2410c", c3: "#2c6e2c", c4: "#8e44ad", gray: "#999" };

  /* 既定の降圧コンバータ(セミナー資料の設計例) */
  const BUCK = { Vi: 12, Vo: 3.3, L: 10e-6, Cap: 100e-6, rC: 0.045, rL: 0.01, R: 0.66, fsw: 200e3 };

  function buckFreqs(p) {
    const wn = 1 / Math.sqrt(p.L * p.Cap);
    const zeta = (Math.sqrt(p.L / p.Cap) / p.R + (p.rL + p.rC) * Math.sqrt(p.Cap / p.L)) / 2;
    const wesr = 1 / (p.rC * p.Cap);
    return { wn, zeta, wesr };
  }

  /** Gvd(jω) = Vi(1+jω/ωesr) / (1 - (ω/ωn)² + j·2ζω/ωn) */
  function gvdResp(p, w) {
    const { wn, zeta, wesr } = buckFreqs(p);
    const num = C.scale([1, w / wesr], p.Vi);
    const den = [1 - (w / wn) * (w / wn), 2 * zeta * w / wn];
    return C.div(num, den);
  }

  /** Gid(jω) = (Vi/R)(1+jωC(R+rC)) / P(jω) */
  function gidResp(p, w) {
    const { wn, zeta } = buckFreqs(p);
    const num = C.scale([1, w * p.Cap * (p.R + p.rC)], p.Vi / p.R);
    const den = [1 - (w / wn) * (w / wn), 2 * zeta * w / wn];
    return C.div(num, den);
  }

  /* ============================================================
     1. 降圧/昇圧コンバータのスイッチング波形(第2・3章)
     ============================================================ */
  function conv(container, opts = {}) {
    const cfg = Object.assign({
      title: "DC-DCコンバータのスイッチング波形",
      topology: "buck", D: 0.275, L_uH: 10, R: 0.66,
    }, opts);

    const { panel, plotArea } = frame(container, cfg.title);
    const topo = selectRow("回路方式", [["buck", "降圧型(Buck)"], ["boost", "昇圧型(Boost)"]]);
    topo.sel.value = cfg.topology;
    const sVi = slider("入力電圧 V<sub>i</sub> [V]", 5, 24, 0.5, 12, (v) => v.toFixed(1));
    const sD = slider("デューティ比 D", 0.05, 0.85, 0.005, cfg.D, (v) => v.toFixed(3));
    const sL = slider("インダクタ L [µH]", 1, 47, 0.5, cfg.L_uH, (v) => v.toFixed(1));
    const sR = slider("負荷抵抗 R [Ω]", 0.2, 20, 0.1, cfg.R, (v) => v.toFixed(1));
    const note = el(`<div style="font-size:0.8rem;color:#666;line-height:1.7;">
      C = 100 µF,f<sub>sw</sub> = 200 kHz 固定。<br>
      ダイオード整流なので,負荷を軽く(R を大きく)すると
      インダクタ電流が途切れて<strong>不連続導通モード(DCM)</strong>になります。</div>`);
    panel.append(topo.row, sVi.row, sD.row, sL.row, sR.row, note);

    const legend = el(`<div style="font-size:0.85rem;margin-bottom:0.4rem;">
      上:<span style="color:${COL.c1};font-weight:700;">―</span> インダクタ電流 i<sub>L</sub>
      (<span style="color:#f5c396;">■</span> スイッチONの期間)
      / 下:<span style="color:${COL.c2};font-weight:700;">―</span> 出力電圧 v<sub>o</sub></div>`);
    const cvI = makeCanvas(230);
    const cvV = makeCanvas(200);
    const m = metricsBar([
      ["mode", "導通モード"],
      ["vo", "V<sub>o</sub>(シミュレーション)"],
      ["vth", "V<sub>o</sub>(CCM理論値)"],
      ["dil", "リプル ΔI<sub>L</sub>"],
    ]);
    plotArea.append(legend, cvI, cvV, m.bar);

    function redraw() {
      const Vi = sVi.get(), D = sD.get(), L = sL.get() * 1e-6, R = sR.get();
      const Cap = 100e-6, fsw = 200e3, Ts = 1 / fsw;
      const isBuck = topo.get() === "buck";

      // 定常状態までスイッチング動作を陽解法で回す
      const stepsPerCycle = 400, dt = Ts / stepsPerCycle;
      const cycles = 400;
      let iL = 0, vC = isBuck ? Vi * D : Vi;
      const run = (record) => {
        const ts = [], is = [], vs = [], ons = [];
        for (let c = 0; c < (record ? 4 : cycles); c++) {
          for (let k = 0; k < stepsPerCycle; k++) {
            const on = (k / stepsPerCycle) < D;
            const vo = vC;
            let diL, dvC;
            if (isBuck) {
              if (on) diL = (Vi - vo) / L;
              else diL = iL > 0 ? (-vo) / L : 0;
              dvC = ((on || iL > 0 ? iL : 0) - vo / R) / Cap;
            } else {
              if (on) { diL = Vi / L; dvC = (-vo / R) / Cap; }
              else if (iL > 0) { diL = (Vi - vo) / L; dvC = (iL - vo / R) / Cap; }
              else { diL = 0; dvC = (-vo / R) / Cap; }
            }
            iL = Math.max(0, iL + diL * dt);
            vC = vC + dvC * dt;
            if (record) {
              ts.push((c * stepsPerCycle + k) * dt * 1e6);
              is.push(iL); vs.push(vC); ons.push(on);
            }
          }
        }
        return { ts, is, vs, ons };
      };
      run(false); // 収束用
      const r = run(true); // 記録用(4周期)

      const iMax = Math.max(...r.is), iMin = Math.min(...r.is);
      const pI = new Plot(cvI, {
        xmin: 0, xmax: r.ts[r.ts.length - 1],
        ymin: Math.min(0, iMin) - 0.1, ymax: iMax * 1.25 + 0.2,
        xlabel: "時間 [µs]", ylabel: "iL [A]", title: "インダクタ電流(定常状態の4周期)",
      });
      pI.clear();
      // ON区間を薄く塗る
      let segStart = null;
      for (let i = 0; i <= r.ts.length; i++) {
        const on = i < r.ts.length ? r.ons[i] : false;
        if (on && segStart === null) segStart = r.ts[i];
        if (!on && segStart !== null) {
          pI.fillPoly([segStart, r.ts[i - 1], r.ts[i - 1], segStart],
            [pI.opts.ymin, pI.opts.ymin, pI.opts.ymax, pI.opts.ymax], "rgba(245,195,150,0.35)");
          segStart = null;
        }
      }
      pI.hline(0, "#c5ccd3", [4, 4]);
      pI.line(r.ts, r.is, COL.c1, 2);

      const vAvg = r.vs.reduce((a, b) => a + b, 0) / r.vs.length;
      const vSpan = Math.max(0.05, (Math.max(...r.vs) - Math.min(...r.vs)) * 3);
      const pV = new Plot(cvV, {
        xmin: 0, xmax: r.ts[r.ts.length - 1],
        ymin: vAvg - vSpan, ymax: vAvg + vSpan,
        xlabel: "時間 [µs]", ylabel: "vo [V]", title: "出力電圧(リプルを拡大表示)",
      });
      pV.clear();
      pV.hline(vAvg, "#c5ccd3", [4, 4]);
      pV.line(r.ts, r.vs, COL.c2, 2);

      const vTh = isBuck ? D * Vi : Vi / (1 - D);
      const dcm = iMin < 1e-3;
      m.cells.mode.textContent = dcm ? "DCM(不連続)" : "CCM(連続)";
      m.cells.mode.style.color = dcm ? "#b04a00" : "";
      m.cells.vo.textContent = vAvg.toFixed(2) + " V";
      m.cells.vth.textContent = vTh.toFixed(2) + " V";
      m.cells.dil.textContent = (iMax - iMin).toFixed(2) + " A";
    }

    [sVi, sD, sL, sR].forEach((s) => s.onInput(redraw));
    topo.onChange(redraw);
    redraw();
  }

  /* ============================================================
     2. フィードバックと無限等比級数(第4章)
     ============================================================ */
  function series(container, opts = {}) {
    const cfg = Object.assign({ title: "フィードバック動作は無限等比級数" }, opts);
    const { panel, plotArea } = frame(container, cfg.title);

    const sA = slider("初項 a(開ループゲイン)", 0.2, 2, 0.05, 1, (v) => v.toFixed(2));
    const sR = slider("公比 r(−一巡ゲイン)", -1.4, 1.4, 0.01, -0.5, (v) => v.toFixed(2));
    const note = el(`<div style="font-size:0.8rem;color:#666;line-height:1.7;">
      閉ループゲインは初項 a = G<sub>open</sub>,
      公比 r = −G<sub>loop</sub> の無限等比級数です。<br>
      |r| &lt; 1 なら部分和は a/(1−r) に収束します。
      |r| ≧ 1 にすると…?</div>`);
    panel.append(sA.row, sR.row, note);

    const legend = el(`<div style="font-size:0.85rem;margin-bottom:0.4rem;">
      <span style="color:${COL.c1};font-weight:700;">●</span> 部分和 S<sub>n</sub>(n 回フィードバックが巡った後の出力)
      &nbsp;<span style="color:${COL.c3};font-weight:700;">--</span> 極限値 a/(1−r)</div>`);
    const cv = makeCanvas(320);
    const m = metricsBar([
      ["conv", "収束判定"],
      ["lim", "極限値 a/(1−r)"],
      ["s20", "S₂₀(20巡目)"],
    ]);
    plotArea.append(legend, cv, m.bar);

    function redraw() {
      const a = sA.get(), r = sR.get();
      const N = 20;
      const ns = [], Ss = [];
      let S = 0, term = a;
      for (let n = 1; n <= N; n++) {
        S += term; term *= r;
        ns.push(n); Ss.push(S);
      }
      const lim = Math.abs(r) < 1 ? a / (1 - r) : null;
      const finite = Ss.filter((v) => isFinite(v));
      let ymin = Math.min(0, ...finite), ymax = Math.max(0, ...finite);
      if (lim !== null) { ymin = Math.min(ymin, lim); ymax = Math.max(ymax, lim); }
      const pad = (ymax - ymin) * 0.15 + 0.1;
      const p = new Plot(cv, {
        xmin: 0, xmax: N + 1, ymin: ymin - pad, ymax: ymax + pad,
        xlabel: "フィードバックの巡回数 n", ylabel: "部分和 Sn",
        title: "無限等比級数の部分和 = フィードバック後の出力",
      });
      p.clear();
      p.hline(0, "#c5ccd3", [4, 4]);
      if (lim !== null) p.hline(lim, COL.c3, [6, 4]);
      p.line(ns, Ss, COL.c1, 1.6);
      p.points(ns, Ss, COL.c1, 3.5);

      const conv2 = Math.abs(r) < 1;
      m.cells.conv.textContent = conv2 ? "収束(|r| < 1)" : "発散(|r| ≧ 1)";
      m.cells.conv.style.color = conv2 ? "" : "#c0392b";
      m.cells.lim.textContent = lim !== null ? lim.toFixed(3) : "—";
      m.cells.s20.textContent = Math.abs(Ss[N - 1]) > 1e6 ? "±∞" : Ss[N - 1].toFixed(3);
    }

    [sA, sR].forEach((s) => s.onInput(redraw));
    redraw();
  }

  /* ============================================================
     3. 極・零点とボード線図(第5章)
     ============================================================ */
  function bodezpk(container, opts = {}) {
    const cfg = Object.assign({ title: "極・零点を動かしてボード線図を描く" }, opts);
    const { panel, plotArea } = frame(container, cfg.title);

    const sK = slider("ゲイン K [dB]", -20, 60, 1, 20, (v) => v.toFixed(0));
    const cInt = checkbox("積分器 1/s を入れる", false);
    const cZ = checkbox("零点を入れる", true);
    const sFz = logSlider("零点周波数 f<sub>z</sub> [Hz]", 1, 5, 3, fmtHz);
    const cRhp = checkbox("零点を右半平面(RHP)にする", false);
    const sFp1 = logSlider("極周波数 f<sub>p1</sub> [Hz]", 1, 5, 2, fmtHz);
    const sFp2 = logSlider("極周波数 f<sub>p2</sub> [Hz]", 1, 6, 4.3, fmtHz);
    const note = el(`<div style="font-size:0.8rem;color:#666;line-height:1.7;">
      G(s) = K・(1 ± s/ω<sub>z</sub>) / (1+s/ω<sub>p1</sub>)(1+s/ω<sub>p2</sub>)<br>
      極で −20 dB/dec・位相 −90°,零点で +20 dB/dec・位相 +90°
      (RHP零点はゲインは同じでも位相が <strong>−90°</strong>)。</div>`);
    panel.append(sK.row, cInt.row, cZ.row, sFz.row, cRhp.row, sFp1.row, sFp2.row, note);

    const cvG = makeCanvas(240);
    const cvP = makeCanvas(240);
    const m = metricsBar([
      ["fgc", "ゲイン交差 f<sub>gc</sub>"],
      ["pm", "位相余裕 P<sub>m</sub>"],
      ["fpc", "位相交差 f<sub>pc</sub>"],
      ["gm", "ゲイン余裕 G<sub>m</sub>"],
    ]);
    plotArea.append(cvG, cvP, m.bar);

    function redraw() {
      const K = Math.pow(10, sK.get() / 20);
      const useInt = cInt.get(), useZ = cZ.get(), rhp = cRhp.get();
      const wz = 2 * Math.PI * sFz.get();
      const wp1 = 2 * Math.PI * sFp1.get(), wp2 = 2 * Math.PI * sFp2.get();
      const fs = freqGrid(1, 1e6, 500);
      const resp = fs.map((f) => {
        const w = 2 * Math.PI * f;
        let g = [K, 0];
        if (useInt) g = C.div(g, [0, w]);
        if (useZ) g = C.mul(g, [1, (rhp ? -1 : 1) * w / wz]);
        g = C.div(g, [1, w / wp1]);
        g = C.div(g, [1, w / wp2]);
        return g;
      });
      const gainDB = resp.map((g) => 20 * Math.log10(C.abs(g)));
      const ph = phaseUnwrap(resp);

      const pG = new Plot(cvG, {
        xmin: 1, xmax: 1e6, ymin: -60, ymax: 80, xlog: true,
        xlabel: "周波数 [Hz]", ylabel: "ゲイン [dB]", title: "ゲイン線図",
      });
      pG.clear();
      pG.hline(0, "#b9c2cb", [4, 4]);
      pG.vline(sFz.get(), useZ ? "#7fb069" : "#eee", [3, 3]);
      pG.vline(sFp1.get(), "#d99", [3, 3]);
      pG.vline(sFp2.get(), "#d99", [3, 3]);
      pG.line(fs, gainDB, COL.c1, 2.2);

      const pP = new Plot(cvP, {
        xmin: 1, xmax: 1e6, ymin: -280, ymax: 100, xlog: true,
        xlabel: "周波数 [Hz]", ylabel: "位相 [deg]", title: "位相線図",
      });
      pP.clear();
      pP.hline(-180, "#c0392b", [4, 4]);
      pP.hline(0, "#c5ccd3", [4, 4]);
      pP.line(fs, ph, COL.c2, 2.2);

      const mg = margins(fs, gainDB, ph);
      m.cells.fgc.textContent = mg.fgc ? fmtHz(mg.fgc) + " Hz" : "—";
      m.cells.pm.textContent = mg.pm !== null ? mg.pm.toFixed(1) + " deg" : "—";
      m.cells.fpc.textContent = mg.fpc ? fmtHz(mg.fpc) + " Hz" : "—";
      m.cells.gm.textContent = mg.gm !== null ? mg.gm.toFixed(1) + " dB" : "∞";
      if (mg.pm !== null) m.cells.pm.style.color = mg.pm < 20 ? "#c0392b" : "";
    }

    [sK, sFz, sFp1, sFp2].forEach((s) => s.onInput(redraw));
    [cInt, cZ, cRhp].forEach((c) => c.onChange(redraw));
    redraw();
  }

  /* ============================================================
     4. ナイキスト線図と安定性(第5章)
     ============================================================ */
  function nyq(container, opts = {}) {
    const cfg = Object.assign({ title: "ナイキスト線図 — 点(−1, j0) にどれだけ近づくか" }, opts);
    const { panel, plotArea } = frame(container, cfg.title);

    const sK = logSlider("一巡ゲイン K", 0, 2.5, 1, (v) => v.toFixed(1));
    const note = el(`<div style="font-size:0.8rem;color:#666;line-height:1.7;">
      一巡伝達関数:G<sub>loop</sub>(s) = K / (1+s/ω₁)(1+s/ω₂)(1+s/ω₃)<br>
      (ω₁ = 2π·10,ω₂ = 2π·100,ω₃ = 2π·1000 rad/s)<br><br>
      1次遅れ3つで位相は最大 −270° まで回るので,
      K を大きくすると軌跡が点 (−1, j0) を囲んで<strong>不安定</strong>になります。</div>`);
    panel.append(sK.row, note);

    const legend = el(`<div style="font-size:0.85rem;margin-bottom:0.4rem;">
      左:ベクトル軌跡(<span style="color:#c0392b;font-weight:700;">×</span> が点(−1, j0))
      / 右下:閉ループのステップ応答</div>`);
    const cvN = makeCanvas(300);
    const cvS = makeCanvas(220);
    const m = metricsBar([
      ["verdict", "安定判定"],
      ["kc", "安定限界のゲイン K<sub>限界</sub>"],
      ["pm", "位相余裕 P<sub>m</sub>"],
    ]);
    plotArea.append(legend, cvN, cvS, m.bar);

    const w1 = 2 * Math.PI * 10, w2 = 2 * Math.PI * 100, w3 = 2 * Math.PI * 1000;
    const loop = (K, w) =>
      C.div([K, 0], C.mul(C.mul([1, w / w1], [1, w / w2]), [1, w / w3]));

    function redraw() {
      const K = sK.get();
      const fs = freqGrid(0.1, 1e5, 800);
      const resp = fs.map((f) => loop(K, 2 * Math.PI * f));
      const re = resp.map((g) => g[0]), im = resp.map((g) => g[1]);

      const range = Math.min(3, Math.max(1.6, K * 0.35));
      const pN = new Plot(cvN, {
        xmin: -range, xmax: range, ymin: -range, ymax: range * 0.5,
        xlabel: "実部 Re", ylabel: "虚部 Im", title: "一巡伝達関数のベクトル軌跡(ω: 0 → ∞)",
      });
      pN.clear();
      // 単位円
      const cxs = [], cys = [];
      for (let i = 0; i <= 100; i++) {
        cxs.push(Math.cos(i / 100 * 2 * Math.PI));
        cys.push(Math.sin(i / 100 * 2 * Math.PI));
      }
      pN.line(cxs, cys, "#c5ccd3", 1.2, [4, 4]);
      pN.line(re, im, COL.c1, 2.2);
      pN.points([-1], [0], "#c0392b", 4.5);
      pN.label(-1, 0.05, "(−1, j0)", "#c0392b");

      // 安定限界: 位相 −180° のときの |G|=1 となる K
      // 位相交差角周波数は K に依らない
      let wpc = null;
      for (let i = 1; i < fs.length; i++) {
        const p0 = Math.atan2(resp[i - 1][1], resp[i - 1][0]);
        const p1 = Math.atan2(resp[i][1], resp[i][0]);
        if (resp[i - 1][0] < 0 && p0 > 0 !== p1 > 0 && Math.abs(p0) > 2) {
          wpc = 2 * Math.PI * fs[i]; break;
        }
      }
      let Kc = null;
      if (wpc !== null) {
        const g1 = C.abs(loop(1, wpc));
        Kc = 1 / g1;
      }
      const stable = Kc === null || K < Kc;

      // 閉ループステップ応答(状態空間: 3つの1次遅れの直列 + 負帰還)
      const deriv = (x) => {
        const e = 1 - x[2];
        return [
          w1 * (K * e - x[0]),
          w2 * (x[0] - x[1]),
          w3 * (x[1] - x[2]),
        ];
      };
      const tEnd = 0.25;
      const r = simODE(deriv, [0, 0, 0], tEnd, 3000);
      const y = col(r.xs, 2);
      const yc = y.map((v) => Math.max(-10, Math.min(10, v)));
      const ymax2 = Math.min(4, Math.max(1.5, Math.max(...yc) * 1.15));
      const ymin2 = Math.max(-3, Math.min(0, Math.min(...yc) * 1.15) - 0.1);
      const pS = new Plot(cvS, {
        xmin: 0, xmax: tEnd * 1000, ymin: ymin2, ymax: ymax2,
        xlabel: "時間 [ms]", ylabel: "出力 y", title: "閉ループのステップ応答",
      });
      pS.clear();
      pS.hline(1, "#c5ccd3", [4, 4]);
      pS.line(r.ts.map((t) => t * 1000), yc, stable ? COL.c3 : "#c0392b", 2);

      m.cells.verdict.textContent = stable ? "安定" : "不安定(発振)";
      m.cells.verdict.style.color = stable ? "" : "#c0392b";
      m.cells.kc.textContent = Kc !== null ? Kc.toFixed(1) : "—";
      // 位相余裕
      const gainDB = resp.map((g) => 20 * Math.log10(C.abs(g)));
      const ph = phaseUnwrap(resp);
      const mg = margins(fs, gainDB, ph);
      m.cells.pm.textContent = mg.pm !== null ? mg.pm.toFixed(1) + " deg" : "—";
    }

    sK.onInput(redraw);
    redraw();
  }

  /* ============================================================
     5. P/PI/PID制御のステップ応答(第6章)
     ============================================================ */
  function fbstep(container, opts = {}) {
    const cfg = Object.assign({ title: "P → PI → PID と改良していく" }, opts);
    const { panel, plotArea } = frame(container, cfg.title);

    const ctrl = selectRow("制御器の種類", [
      ["P", "P制御"],
      ["I", "I制御"],
      ["PI", "PI制御"],
      ["T2", "Type-2(PI + LPF)"],
      ["PID", "実用PID(擬似微分)"],
    ]);
    ctrl.sel.value = "P";
    const sKP = slider("比例ゲイン K<sub>P</sub>", 0, 60, 0.5, 10, (v) => v.toFixed(1));
    const sKI = slider("積分ゲイン K<sub>I</sub>", 0, 60, 0.5, 5, (v) => v.toFixed(1));
    const sKD = slider("微分ゲイン K<sub>D</sub>", 0, 10, 0.1, 2, (v) => v.toFixed(1));
    const sWF = logSlider("LPF周波数 ω<sub>f</sub> [rad/s]", 0.5, 3, 1.7, (v) => v.toFixed(0));
    const cDist = checkbox("t = 5 s で外乱を加える", true);
    const note = el(`<div style="font-size:0.8rem;color:#666;line-height:1.7;">
      制御対象:P(s) = 1/(s²+4s+2)(セミナー資料の例)<br>
      Type-2 は PI の後に LPF,実用PID は擬似微分器(D項+LPF)です。</div>`);
    panel.append(ctrl.row, sKP.row, sKI.row, sKD.row, sWF.row, cDist.row, note);

    const legend = el(`<div style="font-size:0.85rem;margin-bottom:0.4rem;">
      上:<span style="color:${COL.c1};font-weight:700;">―</span> 出力 y(t)
      &nbsp;<span style="color:#999;font-weight:700;">--</span> 目標値 r = 1
      / 下:<span style="color:${COL.c2};font-weight:700;">―</span> 操作量 u(t)</div>`);
    const cvY = makeCanvas(250);
    const cvU = makeCanvas(180);
    const m = metricsBar([
      ["os", "オーバーシュート"],
      ["ts", "整定時間(±2%)"],
      ["ess", "定常偏差(外乱前)"],
    ]);
    plotArea.append(legend, cvY, cvU, m.bar);

    function updateVis() {
      const c = ctrl.get();
      sKP.show(c !== "I");
      sKI.show(c !== "P");
      sKD.show(c === "PID");
      sWF.show(c === "PID" || c === "T2");
    }

    function redraw() {
      updateVis();
      const c = ctrl.get();
      const KP = c === "I" ? 0 : sKP.get();
      const KI = c === "P" ? 0 : sKI.get();
      const KD = c === "PID" ? sKD.get() : 0;
      const wf = sWF.get();
      const tEnd = 10, N = 4000;
      const tDist = 5, dAmp = cDist.get() ? 0.5 : 0;

      // 状態: [x1, x2](プラント), z(誤差積分), xd(擬似微分LPF), xf(Type-2 LPF)
      const uLog = [];
      const deriv = (x, t) => {
        const y = x[0];
        const e = 1 - y;
        let u = KP * e + KI * x[2];
        let dxd = 0, dxf = 0;
        if (c === "PID") {
          dxd = wf * (e - x[3]);
          u += KD * dxd; // KD·ωf(e − xd) ≒ KD·de/dt
        }
        if (c === "T2") {
          dxf = wf * (u - x[4]);
          u = x[4];
        }
        const d = t >= tDist ? dAmp : 0;
        const uin = u + d;
        return [x[1], uin - 4 * x[1] - 2 * x[0], e, dxd, dxf];
      };
      const r = simODE(deriv, [0, 0, 0, 0, 0], tEnd, N);
      const y = col(r.xs, 0);
      // 操作量を再計算してログ
      for (let i = 0; i < r.ts.length; i++) {
        const x = r.xs[i];
        const e = 1 - x[0];
        let u = KP * e + KI * x[2];
        if (c === "PID") u += KD * wf * (e - x[3]);
        if (c === "T2") u = x[4];
        uLog.push(u);
      }

      const ymax = Math.max(1.3, Math.max(...y) * 1.1);
      const pY = new Plot(cvY, {
        xmin: 0, xmax: tEnd, ymin: -0.05, ymax,
        xlabel: "時間 t [s]", ylabel: "出力 y", title: "ステップ応答" + (dAmp ? "(t = 5 s で外乱 0.5)" : ""),
      });
      pY.clear();
      pY.hline(1, "#999", [5, 4]);
      if (dAmp) pY.vline(tDist, "#d9b", [3, 3]);
      pY.line(r.ts, y, COL.c1, 2.2);

      const uMax = Math.max(...uLog), uMin = Math.min(...uLog);
      const pU = new Plot(cvU, {
        xmin: 0, xmax: tEnd, ymin: Math.min(0, uMin) - 0.5, ymax: uMax * 1.1 + 0.5,
        xlabel: "時間 t [s]", ylabel: "操作量 u", title: "操作量(制御器の出力)",
      });
      pU.clear();
      pU.hline(0, "#c5ccd3", [4, 4]);
      pU.line(r.ts, uLog, COL.c2, 1.8);

      // 指標(外乱前の区間で評価)
      const iEnd = Math.floor(N * tDist / tEnd) - 1;
      const seg = y.slice(0, iEnd);
      const peak = Math.max(...seg);
      const os = Math.max(0, (peak - 1) * 100);
      let tsIdx = null;
      for (let i = seg.length - 1; i >= 0; i--) {
        if (Math.abs(seg[i] - 1) > 0.02) { tsIdx = i + 1; break; }
      }
      const tsVal = tsIdx !== null && tsIdx < seg.length ? r.ts[tsIdx] : null;
      const ess = Math.abs(1 - seg[seg.length - 1]);
      m.cells.os.textContent = os.toFixed(1) + " %";
      m.cells.ts.textContent = tsVal !== null ? tsVal.toFixed(2) + " s" : "> 5 s";
      m.cells.ess.textContent = ess < 5e-4 ? "≒ 0" : ess.toFixed(3);
    }

    [sKP, sKI, sKD, sWF].forEach((s) => s.onInput(redraw));
    ctrl.onChange(redraw);
    cDist.onChange(redraw);
    redraw();
  }

  /* ============================================================
     6. プラント Gvd(s) の周波数特性(第7章)
     ============================================================ */
  function gvd(container, opts = {}) {
    const cfg = Object.assign({ title: "降圧コンバータのプラント Gvd(s) を観察する" }, opts);
    const { panel, plotArea } = frame(container, cfg.title);

    const sVi = slider("入力電圧 V<sub>i</sub> [V]", 5, 24, 0.5, 12, (v) => v.toFixed(1));
    const sL = slider("インダクタ L [µH]", 2, 47, 0.5, 10, (v) => v.toFixed(1));
    const sC = slider("キャパシタ C [µF]", 22, 470, 1, 100, (v) => v.toFixed(0));
    const sRc = slider("ESR r<sub>C</sub> [mΩ]", 5, 200, 1, 45, (v) => v.toFixed(0));
    const sR = slider("負荷抵抗 R [Ω]", 0.2, 5, 0.02, 0.66, (v) => v.toFixed(2));
    const note = el(`<div style="font-size:0.8rem;color:#666;line-height:1.7;">
      G<sub>vd</sub>(s) = V<sub>i</sub>(1+s/ω<sub>esr</sub>) / P(s)<br>
      P(s):LCによる2次遅れ系(共振周波数 f<sub>n</sub>)<br><br>
      緑の縦線:f<sub>n</sub>,橙の縦線:f<sub>esr</sub></div>`);
    panel.append(sVi.row, sL.row, sC.row, sRc.row, sR.row, note);

    const cvG = makeCanvas(240);
    const cvP = makeCanvas(240);
    const m = metricsBar([
      ["kdc", "DCゲイン"],
      ["fn", "共振周波数 f<sub>n</sub>"],
      ["zeta", "減衰係数 ζ"],
      ["fesr", "ESR零点 f<sub>esr</sub>"],
    ]);
    plotArea.append(cvG, cvP, m.bar);

    function redraw() {
      const p = {
        Vi: sVi.get(), L: sL.get() * 1e-6, Cap: sC.get() * 1e-6,
        rC: sRc.get() * 1e-3, rL: 0.01, R: sR.get(),
      };
      const { wn, zeta, wesr } = buckFreqs(p);
      const fs = freqGrid(10, 1e6, 500);
      const resp = fs.map((f) => gvdResp(p, 2 * Math.PI * f));
      const gainDB = resp.map((g) => 20 * Math.log10(C.abs(g)));
      const ph = phaseUnwrap(resp);

      const pG = new Plot(cvG, {
        xmin: 10, xmax: 1e6, ymin: -60, ymax: 50, xlog: true,
        xlabel: "周波数 [Hz]", ylabel: "ゲイン [dB]", title: "Gvd(s) のゲイン線図",
      });
      pG.clear();
      pG.hline(0, "#b9c2cb", [4, 4]);
      pG.vline(wn / 2 / Math.PI, "#7fb069", [3, 3]);
      pG.vline(wesr / 2 / Math.PI, "#e6a23c", [3, 3]);
      pG.line(fs, gainDB, COL.c1, 2.2);

      const pP = new Plot(cvP, {
        xmin: 10, xmax: 1e6, ymin: -200, ymax: 20, xlog: true,
        xlabel: "周波数 [Hz]", ylabel: "位相 [deg]", title: "Gvd(s) の位相線図",
      });
      pP.clear();
      pP.hline(-90, "#c5ccd3", [4, 4]);
      pP.hline(-180, "#c0392b", [4, 4]);
      pP.vline(wn / 2 / Math.PI, "#7fb069", [3, 3]);
      pP.vline(wesr / 2 / Math.PI, "#e6a23c", [3, 3]);
      pP.line(fs, ph, COL.c2, 2.2);

      m.cells.kdc.textContent = (20 * Math.log10(sVi.get())).toFixed(2) + " dB";
      m.cells.fn.textContent = fmtHz(wn / 2 / Math.PI) + " Hz";
      m.cells.zeta.textContent = zeta.toFixed(2);
      m.cells.zeta.style.color = zeta < 0.5 ? "#b04a00" : "";
      m.cells.fesr.textContent = fmtHz(wesr / 2 / Math.PI) + " Hz";
    }

    [sVi, sL, sC, sRc, sR].forEach((s) => s.onInput(redraw));
    redraw();
  }

  /* ============================================================
     7. フィードバック無しの負荷過渡応答(第8章)
     ============================================================ */
  function openload(container, opts = {}) {
    const cfg = Object.assign({ title: "フィードバックが無いとどうなる? — 負荷急変への応答" }, opts);
    const { panel, plotArea } = frame(container, cfg.title);

    const sD = slider("デューティ比 D(固定)", 0.1, 0.5, 0.005, 0.28, (v) => v.toFixed(3));
    const sIo2 = slider("急変後の負荷電流 [A]", 1, 10, 0.25, 7.5, (v) => v.toFixed(2));
    const note = el(`<div style="font-size:0.8rem;color:#666;line-height:1.7;">
      降圧コンバータの平均化モデル(V<sub>i</sub> = 12 V,L = 10 µH,
      C = 100 µF,r<sub>C</sub> = 45 mΩ,r<sub>L</sub> = 10 mΩ)。<br>
      t = 0.5 ms で負荷電流を 2.5 A → 設定値へステップ変化させます。
      デューティ比は<strong>固定のまま</strong>です。</div>`);
    panel.append(sD.row, sIo2.row, note);

    const legend = el(`<div style="font-size:0.85rem;margin-bottom:0.4rem;">
      上:<span style="color:${COL.c2};font-weight:700;">―</span> 出力電圧 v<sub>o</sub>
      &nbsp;<span style="color:#999;font-weight:700;">--</span> 設計値 3.3 V
      / 下:<span style="color:${COL.c1};font-weight:700;">―</span> インダクタ電流 i<sub>L</sub></div>`);
    const cvV = makeCanvas(240);
    const cvI = makeCanvas(190);
    const m = metricsBar([
      ["vpre", "急変前の V<sub>o</sub>"],
      ["vpost", "急変後の V<sub>o</sub>"],
      ["dvo", "電圧変動 ΔV<sub>o</sub>"],
    ]);
    plotArea.append(legend, cvV, cvI, m.bar);

    function redraw() {
      const p = BUCK;
      const D = sD.get(), Io1 = 2.5, Io2 = sIo2.get();
      const tStep = 0.5e-3, tEnd = 2.5e-3;
      const io = (t) => (t < tStep ? Io1 : Io2);
      const deriv = (x, t) => {
        const vo = x[1] + p.rC * (x[0] - io(t));
        return [
          (D * p.Vi - vo - p.rL * x[0]) / p.L,
          (x[0] - io(t)) / p.Cap,
        ];
      };
      // 初期値は急変前の定常状態
      const vo0 = D * p.Vi - p.rL * Io1;
      const r = simODE(deriv, [Io1, vo0], tEnd, 6000);
      const iL = col(r.xs, 0);
      const vo = r.xs.map((x, i) => x[1] + p.rC * (x[0] - io(r.ts[i])));
      const tms = r.ts.map((t) => t * 1e3);

      const vmin = Math.min(...vo), vmax = Math.max(...vo);
      const pV = new Plot(cvV, {
        xmin: 0, xmax: tEnd * 1e3, ymin: vmin - 0.3, ymax: vmax + 0.3,
        xlabel: "時間 [ms]", ylabel: "vo [V]", title: "出力電圧(デューティ比固定)",
      });
      pV.clear();
      pV.hline(3.3, "#999", [5, 4]);
      pV.vline(tStep * 1e3, "#d9b", [3, 3]);
      pV.line(tms, vo, COL.c2, 2.2);

      const pI = new Plot(cvI, {
        xmin: 0, xmax: tEnd * 1e3, ymin: Math.min(0, Math.min(...iL)) - 0.5,
        ymax: Math.max(...iL) * 1.15 + 0.5,
        xlabel: "時間 [ms]", ylabel: "iL [A]", title: "インダクタ電流",
      });
      pI.clear();
      pI.hline(0, "#c5ccd3", [4, 4]);
      pI.vline(tStep * 1e3, "#d9b", [3, 3]);
      pI.line(tms, iL, COL.c1, 2);

      const vPre = vo[Math.floor(vo.length * tStep / tEnd) - 5];
      const vPost = vo[vo.length - 1];
      m.cells.vpre.textContent = vPre.toFixed(3) + " V";
      m.cells.vpost.textContent = vPost.toFixed(3) + " V";
      const dvo = Math.max(...vo.slice(Math.floor(vo.length * tStep / tEnd))) -
                  Math.min(...vo.slice(Math.floor(vo.length * tStep / tEnd)));
      m.cells.dvo.textContent = dvo.toFixed(3) + " V";
    }

    [sD, sIo2].forEach((s) => s.onInput(redraw));
    redraw();
  }

  /* ============================================================
     8. ループ整形による補償器設計(第9章)
     ============================================================ */

  /** 補償器 Gc(jω):積分ゲイン ωi と零点・極から計算 */
  function gcResp(cp, w) {
    // Gc = (ωi/s)·(1+s/ωz1)/(1+s/ωp1) ·[(1+s/ωz2)/(1+s/ωp2)](Type-3のみ)
    let g = C.div([cp.wi, 0], [0, w]); // ωi/s
    if (cp.type !== "I") {
      g = C.mul(g, [1, w / cp.wz1]);
      if (cp.type !== "PI") g = C.div(g, [1, w / cp.wp1]);
      if (cp.type === "T3") {
        g = C.mul(g, [1, w / cp.wz2]);
        g = C.div(g, [1, w / cp.wp2]);
      }
    }
    return g;
  }

  function loopdesign(container, opts = {}) {
    const cfg = Object.assign({ title: "補償器を設計して一巡伝達関数 T(s) を整形する" }, opts);
    const { panel, plotArea } = frame(container, cfg.title);

    const ctype = selectRow("補償器の種類", [
      ["I", "積分器のみ"],
      ["PI", "PI(1p-1z)"],
      ["T2", "Type-2(2p-1z)"],
      ["T3", "Type-3(3p-2z)"],
    ]);
    ctype.sel.value = "T3";
    const sWi = logSlider("積分ゲイン f<sub>i</sub> [Hz]", 2, 5, 3.4, fmtHz);
    const sFz1 = logSlider("零点 f<sub>z1</sub> [Hz]", 2.3, 4.5, Math.log10(5030), fmtHz);
    const sFz2 = logSlider("零点 f<sub>z2</sub> [Hz]", 2.3, 4.5, Math.log10(5030), fmtHz);
    const sFp1 = logSlider("極 f<sub>p1</sub> [Hz]", 3.5, 5.7, Math.log10(35400), fmtHz);
    const sFp2 = logSlider("極 f<sub>p2</sub> [Hz]", 4, 6, Math.log10(200e3), fmtHz);
    const note = el(`<div style="font-size:0.8rem;color:#666;line-height:1.7;">
      プラントはセミナー資料の降圧コンバータ
      (f<sub>n</sub> ≒ 5.03 kHz,f<sub>esr</sub> ≒ 35.4 kHz,ζ ≒ 0.26)。<br>
      <strong>極零相殺</strong>の狙い:f<sub>z1</sub> = f<sub>z2</sub> = f<sub>n</sub>,
      f<sub>p1</sub> = f<sub>esr</sub> に合わせてみましょう。</div>`);
    panel.append(ctype.row, sWi.row, sFz1.row, sFz2.row, sFp1.row, sFp2.row, note);

    const legend = el(`<div style="font-size:0.85rem;margin-bottom:0.4rem;">
      <span style="color:#aaa;font-weight:700;">―</span> プラント G<sub>vd</sub>
      &nbsp;<span style="color:${COL.c3};font-weight:700;">―</span> 補償器 G<sub>c</sub>
      &nbsp;<span style="color:${COL.c1};font-weight:700;">―</span> 一巡伝達関数 T(s)</div>`);
    const cvG = makeCanvas(250);
    const cvP = makeCanvas(250);
    const m = metricsBar([
      ["fc", "クロスオーバー周波数 f<sub>c</sub>"],
      ["pm", "位相余裕 P<sub>m</sub>"],
      ["gm", "ゲイン余裕 G<sub>m</sub>"],
      ["verdict", "判定(P<sub>m</sub> ≧ 45°?)"],
    ]);
    plotArea.append(legend, cvG, cvP, m.bar);

    function redraw() {
      const type = ctype.get();
      sFz1.show(type !== "I");
      sFz2.show(type === "T3");
      sFp1.show(type === "T2" || type === "T3");
      sFp2.show(type === "T3");

      const cp = {
        type,
        wi: 2 * Math.PI * sWi.get(),
        wz1: 2 * Math.PI * sFz1.get(), wz2: 2 * Math.PI * sFz2.get(),
        wp1: 2 * Math.PI * sFp1.get(), wp2: 2 * Math.PI * sFp2.get(),
      };
      const fs = freqGrid(10, 1e6, 500);
      const gp = fs.map((f) => gvdResp(BUCK, 2 * Math.PI * f));
      const gc = fs.map((f) => gcResp(cp, 2 * Math.PI * f));
      const T = fs.map((_, i) => C.mul(gp[i], gc[i]));
      const dB = (resp) => resp.map((g) => 20 * Math.log10(C.abs(g)));
      const gpDB = dB(gp), gcDB = dB(gc), TDB = dB(T);
      const gpPh = phaseUnwrap(gp), gcPh = phaseUnwrap(gc), TPh = phaseUnwrap(T);

      const pG = new Plot(cvG, {
        xmin: 10, xmax: 1e6, ymin: -60, ymax: 80, xlog: true,
        xlabel: "周波数 [Hz]", ylabel: "ゲイン [dB]", title: "ゲイン線図",
      });
      pG.clear();
      pG.hline(0, "#b9c2cb", [4, 4]);
      pG.line(fs, gpDB, "#bbb", 1.6, [5, 3]);
      pG.line(fs, gcDB, COL.c3, 1.6, [2, 3]);
      pG.line(fs, TDB, COL.c1, 2.4);

      const pP = new Plot(cvP, {
        xmin: 10, xmax: 1e6, ymin: -280, ymax: 100, xlog: true,
        xlabel: "周波数 [Hz]", ylabel: "位相 [deg]", title: "位相線図",
      });
      pP.clear();
      pP.hline(-180, "#c0392b", [4, 4]);
      pP.line(fs, gpPh, "#bbb", 1.6, [5, 3]);
      pP.line(fs, gcPh, COL.c3, 1.6, [2, 3]);
      pP.line(fs, TPh, COL.c1, 2.4);

      const mg = margins(fs, TDB, TPh);
      m.cells.fc.textContent = mg.fgc ? fmtHz(mg.fgc) + " Hz" : "—";
      m.cells.pm.textContent = mg.pm !== null ? mg.pm.toFixed(1) + " deg" : "—";
      m.cells.gm.textContent = mg.gm !== null ? mg.gm.toFixed(1) + " dB" : "∞";
      let verdict = "—", colr = "";
      if (mg.pm !== null) {
        if (mg.pm >= 45) { verdict = "OK(基準を満たす)"; colr = "#2c6e2c"; }
        else if (mg.pm > 0) { verdict = "余裕不足"; colr = "#b04a00"; }
        else { verdict = "不安定!"; colr = "#c0392b"; }
      }
      m.cells.verdict.textContent = verdict;
      m.cells.verdict.style.color = colr;
      if (mg.fgc) { pG.vline(mg.fgc, "#e6a23c", [3, 3]); pP.vline(mg.fgc, "#e6a23c", [3, 3]); }
    }

    [sWi, sFz1, sFz2, sFp1, sFp2].forEach((s) => s.onInput(redraw));
    ctype.onChange(redraw);
    redraw();
  }

  /* ============================================================
     9. 閉ループの負荷過渡応答(第9章)
     ============================================================ */
  function closedtrans(container, opts = {}) {
    const cfg = Object.assign({ title: "設計した補償器で負荷急変を抑え込む" }, opts);
    const { panel, plotArea } = frame(container, cfg.title);

    const sWi = logSlider("積分ゲイン f<sub>i</sub> [Hz]", 2.5, 4.5, 3.4, fmtHz);
    const sFz = logSlider("零点 f<sub>z1</sub> = f<sub>z2</sub> [Hz]", 2.7, 4.3, Math.log10(5030), fmtHz);
    const cOpen = checkbox("フィードバック無し(灰色破線)も表示", true);
    const note = el(`<div style="font-size:0.8rem;color:#666;line-height:1.7;">
      Type-3補償器(f<sub>p1</sub> = 35.4 kHz,f<sub>p2</sub> = 200 kHz 固定)+
      降圧コンバータ平均化モデル。<br>
      t = 0.5 ms で負荷 2.5 A → 7.5 A のステップ変化。<br><br>
      f<sub>i</sub> を上げると応答は速くなりますが,
      上げすぎると位相余裕が減ってリンギングが出ます。</div>`);
    panel.append(sWi.row, sFz.row, cOpen.row, note);

    const legend = el(`<div style="font-size:0.85rem;margin-bottom:0.4rem;">
      上:<span style="color:${COL.c2};font-weight:700;">―</span> 出力電圧 v<sub>o</sub>
      / 下:<span style="color:${COL.c4};font-weight:700;">―</span> デューティ比 D</div>`);
    const cvV = makeCanvas(250);
    const cvD = makeCanvas(180);
    const m = metricsBar([
      ["fc", "設計上の f<sub>c</sub>"],
      ["pm", "位相余裕 P<sub>m</sub>"],
      ["dvo", "電圧変動 ΔV<sub>o</sub>"],
      ["tset", "整定時間(±1%)"],
    ]);
    plotArea.append(legend, cvV, cvD, m.bar);

    function redraw() {
      const p = BUCK;
      const wi = 2 * Math.PI * sWi.get();
      const wz = 2 * Math.PI * sFz.get();
      const wp1 = 2 * Math.PI * 35.4e3, wp2 = 2 * Math.PI * 200e3;
      const Vref = 3.3;
      const tStep = 0.5e-3, tEnd = 2.0e-3;
      const Io1 = 2.5, Io2 = 7.5;
      const io = (t) => (t < tStep ? Io1 : Io2);

      // リードラグ (1+s/ωz)/(1+s/ωp): y = a·u + (1−a)·x, x' = ωp(u−x), a = ωp/ωz
      const a1 = wp1 / wz, a2 = wp2 / wz;
      const lead = (a, x, u) => a * u + (1 - a) * x;

      // 状態: [iL, vC, z(積分), x1(リード1), x2(リード2)]
      const duty = (x) => {
        const yy1 = lead(a1, x[3], x[2]);
        const yy2 = lead(a2, x[4], yy1);
        return Math.max(0.02, Math.min(0.95, yy2));
      };
      const deriv = (x, t) => {
        const vo = x[1] + p.rC * (x[0] - io(t));
        const e = Vref - vo;
        const yy1 = lead(a1, x[3], x[2]);
        const D = duty(x);
        return [
          (D * p.Vi - vo - p.rL * x[0]) / p.L,
          (x[0] - io(t)) / p.Cap,
          wi * e,
          wp1 * (x[2] - x[3]),
          wp2 * (yy1 - x[4]),
        ];
      };
      // 初期定常値
      const Dss = (Vref + p.rL * Io1) / p.Vi;
      const x0 = [Io1, Vref, Dss, Dss, Dss];
      const N = 12000;
      const r = simODE(deriv, x0, tEnd, N);
      const vo = r.xs.map((x, i) => x[1] + p.rC * (x[0] - io(r.ts[i])));
      const Ds = r.xs.map((x) => duty(x));
      const tms = r.ts.map((t) => t * 1e3);

      // フィードバック無し比較
      let voOpen = null;
      if (cOpen.get()) {
        const derivO = (x, t) => {
          const v = x[1] + p.rC * (x[0] - io(t));
          return [(Dss * p.Vi - v - p.rL * x[0]) / p.L, (x[0] - io(t)) / p.Cap];
        };
        const rO = simODE(derivO, [Io1, Vref], tEnd, 6000);
        voOpen = { ts: rO.ts.map((t) => t * 1e3), vo: rO.xs.map((x, i) => x[1] + p.rC * (x[0] - io(rO.ts[i]))) };
      }

      let vmin = Math.min(...vo), vmax = Math.max(...vo);
      if (voOpen) { vmin = Math.min(vmin, ...voOpen.vo); vmax = Math.max(vmax, ...voOpen.vo); }
      const pV = new Plot(cvV, {
        xmin: 0, xmax: tEnd * 1e3, ymin: vmin - 0.15, ymax: vmax + 0.15,
        xlabel: "時間 [ms]", ylabel: "vo [V]", title: "出力電圧の負荷過渡応答",
      });
      pV.clear();
      pV.hline(3.3, "#999", [5, 4]);
      pV.vline(tStep * 1e3, "#d9b", [3, 3]);
      if (voOpen) pV.line(voOpen.ts, voOpen.vo, "#aaa", 1.8, [6, 4]);
      pV.line(tms, vo, COL.c2, 2.2);

      const pD = new Plot(cvD, {
        xmin: 0, xmax: tEnd * 1e3, ymin: 0, ymax: 1,
        xlabel: "時間 [ms]", ylabel: "D", title: "デューティ比(補償器の出力)",
      });
      pD.clear();
      pD.hline(Dss, "#c5ccd3", [4, 4]);
      pD.vline(tStep * 1e3, "#d9b", [3, 3]);
      pD.line(tms, Ds, COL.c4, 2);

      // 周波数特性から fc, Pm を計算
      const cp = { type: "T3", wi, wz1: wz, wz2: wz, wp1, wp2 };
      const fsg = freqGrid(10, 1e6, 400);
      const T = fsg.map((f) => C.mul(gvdResp(p, 2 * Math.PI * f), gcResp(cp, 2 * Math.PI * f)));
      const TDB = T.map((g) => 20 * Math.log10(C.abs(g)));
      const TPh = phaseUnwrap(T);
      const mg = margins(fsg, TDB, TPh);
      m.cells.fc.textContent = mg.fgc ? fmtHz(mg.fgc) + " Hz" : "—";
      m.cells.pm.textContent = mg.pm !== null ? mg.pm.toFixed(1) + " deg" : "—";
      if (mg.pm !== null) m.cells.pm.style.color = mg.pm < 45 ? "#c0392b" : "";

      const after = vo.slice(Math.floor(N * tStep / tEnd));
      m.cells.dvo.textContent = (Math.max(...after) - Math.min(...after)).toFixed(3) + " V";
      let tset = null;
      for (let i = vo.length - 1; i >= Math.floor(N * tStep / tEnd); i--) {
        if (Math.abs(vo[i] - 3.3) > 0.033) { tset = r.ts[i] - tStep; break; }
      }
      m.cells.tset.textContent = tset !== null && tset > 0 ? (tset * 1e6).toFixed(0) + " µs" : "—";
    }

    [sWi, sFz].forEach((s) => s.onInput(redraw));
    cOpen.onChange(redraw);
    redraw();
  }

  /* ============================================================
     10. 右半平面零点の影響(第10章)
     ============================================================ */
  function rhpz(container, opts = {}) {
    const cfg = Object.assign({ title: "右半平面零点(RHP-Z)— 一瞬「逆に動く」やっかいな零点" }, opts);
    const { panel, plotArea } = frame(container, cfg.title);

    const sRatio = logSlider("ω<sub>rhp</sub> / ω<sub>n</sub> の比", Math.log10(0.5), Math.log10(30), 1, (v) => v.toFixed(1) + " 倍");
    const cCmp = checkbox("RHP零点なし(灰色破線)と比較", true);
    const note = el(`<div style="font-size:0.8rem;color:#666;line-height:1.7;">
      G(s) = (1 − s/ω<sub>rhp</sub>) / P(s),
      P(s) は ω<sub>n</sub> = 2π·1 kHz,ζ = 0.5 の2次遅れ系。<br><br>
      昇圧型・昇降圧型コンバータの G<sub>vd</sub>(s) に現れます。
      ω<sub>rhp</sub> = D'V<sub>i</sub>/(L·I<sub>o</sub>) なので,
      <strong>大電力になるほど低周波に降りてくる</strong>のがポイントです。</div>`);
    panel.append(sRatio.row, cCmp.row, note);

    const legend = el(`<div style="font-size:0.85rem;margin-bottom:0.4rem;">
      上:ステップ応答 / 下:位相線図(ゲインは同じでも位相だけ遅れます)</div>`);
    const cvS = makeCanvas(240);
    const cvP = makeCanvas(220);
    const m = metricsBar([
      ["frhp", "f<sub>rhp</sub>"],
      ["under", "アンダーシュート"],
      ["ph", "ω<sub>n</sub> での追加位相遅れ"],
    ]);
    plotArea.append(legend, cvS, cvP, m.bar);

    function redraw() {
      const wn = 2 * Math.PI * 1000, zeta = 0.5;
      const wrhp = wn * sRatio.get();

      // ステップ応答: y = y0 − (1/ωrhp)·dy0/dt(y0 は 1/P(s) のステップ応答)
      const deriv = (x) => [x[1], wn * wn * (1 - x[0]) - 2 * zeta * wn * x[1]];
      const tEnd = 6 / (zeta * wn) * 2;
      const r = simODE(deriv, [0, 0], tEnd, 3000);
      const y0 = col(r.xs, 0), dy0 = col(r.xs, 1);
      const y = y0.map((v, i) => v - dy0[i] / wrhp);
      const tms = r.ts.map((t) => t * 1e3);

      const ymin = Math.min(0, Math.min(...y)) - 0.1;
      const ymax = Math.max(1.3, Math.max(...y)) + 0.1;
      const pS = new Plot(cvS, {
        xmin: 0, xmax: tEnd * 1e3, ymin, ymax,
        xlabel: "時間 [ms]", ylabel: "出力", title: "ステップ応答 — まず逆方向に動く",
      });
      pS.clear();
      pS.hline(1, "#999", [5, 4]);
      pS.hline(0, "#c5ccd3", [4, 4]);
      if (cCmp.get()) pS.line(tms, y0, "#aaa", 1.8, [6, 4]);
      pS.line(tms, y, COL.c2, 2.2);

      // 位相線図
      const fs = freqGrid(10, 1e5, 400);
      const resp = fs.map((f) => {
        const w = 2 * Math.PI * f;
        const num = [1, -w / wrhp];
        const den = [1 - (w / wn) * (w / wn), 2 * zeta * w / wn];
        return C.div(num, den);
      });
      const respN = fs.map((f) => {
        const w = 2 * Math.PI * f;
        return C.div([1, 0], [1 - (w / wn) * (w / wn), 2 * zeta * w / wn]);
      });
      const ph = phaseUnwrap(resp), phN = phaseUnwrap(respN);
      const pP = new Plot(cvP, {
        xmin: 10, xmax: 1e5, ymin: -280, ymax: 10, xlog: true,
        xlabel: "周波数 [Hz]", ylabel: "位相 [deg]", title: "位相線図(RHP零点あり/なし)",
      });
      pP.clear();
      pP.hline(-180, "#c0392b", [4, 4]);
      if (cCmp.get()) pP.line(fs, phN, "#aaa", 1.8, [6, 4]);
      pP.line(fs, ph, COL.c2, 2.2);
      pP.vline(wrhp / 2 / Math.PI, "#e6a23c", [3, 3]);

      m.cells.frhp.textContent = fmtHz(wrhp / 2 / Math.PI) + " Hz";
      const under = Math.max(0, -Math.min(...y)) * 100;
      m.cells.under.textContent = under.toFixed(1) + " %";
      m.cells.under.style.color = under > 10 ? "#c0392b" : "";
      // ωn における位相差
      const iN = fs.findIndex((f) => f >= 1000);
      m.cells.ph.textContent = (ph[iN] - phN[iN]).toFixed(1) + " deg";
    }

    sRatio.onInput(redraw);
    cCmp.onChange(redraw);
    redraw();
  }

  /* ============================================================
     11. 電流ループによるプラント特性の変化(第10章)
     ============================================================ */
  function cmc(container, opts = {}) {
    const cfg = Object.assign({ title: "電流ループを閉じるとプラントが素直になる" }, opts);
    const { panel, plotArea } = frame(container, cfg.title);

    const sKi = slider("電流センサゲイン K<sub>i</sub>", 0, 5, 0.05, 0, (v) => v.toFixed(2));
    const note = el(`<div style="font-size:0.8rem;color:#666;line-height:1.7;">
      電圧ループから見たプラント:<br>
      G<sub>p</sub>(s) = F<sub>m</sub>G<sub>vd</sub>(s) / (1 + F<sub>m</sub>G<sub>id</sub>(s)K<sub>i</sub>)<br>
      (F<sub>m</sub> = 1,降圧コンバータはセミナー資料の設計例)<br><br>
      K<sub>i</sub> = 0 が電圧モード制御(VMC)のプラントです。
      K<sub>i</sub> を上げていくと,LCの共振ピークがつぶれて
      急激な位相遅れが消えていきます。</div>`);
    panel.append(sKi.row, note);

    const legend = el(`<div style="font-size:0.85rem;margin-bottom:0.4rem;">
      <span style="color:#aaa;font-weight:700;">--</span> K<sub>i</sub> = 0(VMC のプラント)
      &nbsp;<span style="color:${COL.c1};font-weight:700;">―</span> 電流ループを閉じたプラント</div>`);
    const cvG = makeCanvas(240);
    const cvP = makeCanvas(240);
    const m = metricsBar([
      ["peak", "共振ピークの高さ"],
      ["ph", "f<sub>n</sub> 直後の位相"],
      ["hint", "電圧補償器の目安"],
    ]);
    plotArea.append(legend, cvG, cvP, m.bar);

    function redraw() {
      const p = BUCK;
      const Ki = sKi.get();
      const fs = freqGrid(10, 1e6, 500);
      const respV = [], respC = [];
      for (const f of fs) {
        const w = 2 * Math.PI * f;
        const gvdv = gvdResp(p, w);
        const gidv = gidResp(p, w);
        respV.push(gvdv);
        respC.push(C.div(gvdv, C.add([1, 0], C.scale(gidv, Ki))));
      }
      const dBv = respV.map((g) => 20 * Math.log10(C.abs(g)));
      const dBc = respC.map((g) => 20 * Math.log10(C.abs(g)));
      const phv = phaseUnwrap(respV), phc = phaseUnwrap(respC);

      const pG = new Plot(cvG, {
        xmin: 10, xmax: 1e6, ymin: -60, ymax: 50, xlog: true,
        xlabel: "周波数 [Hz]", ylabel: "ゲイン [dB]", title: "ゲイン線図",
      });
      pG.clear();
      pG.hline(0, "#b9c2cb", [4, 4]);
      pG.line(fs, dBv, "#aaa", 1.8, [6, 4]);
      pG.line(fs, dBc, COL.c1, 2.2);

      const pP = new Plot(cvP, {
        xmin: 10, xmax: 1e6, ymin: -200, ymax: 20, xlog: true,
        xlabel: "周波数 [Hz]", ylabel: "位相 [deg]", title: "位相線図",
      });
      pP.clear();
      pP.hline(-90, "#c5ccd3", [4, 4]);
      pP.hline(-180, "#c0392b", [4, 4]);
      pP.line(fs, phv, "#aaa", 1.8, [6, 4]);
      pP.line(fs, phc, COL.c2, 2.2);

      // 共振ピーク: DCゲインとの差の最大値
      const dc = dBc[0];
      let peak = 0;
      for (let i = 0; i < fs.length; i++) {
        if (fs[i] < 100e3) peak = Math.max(peak, dBc[i] - dc);
      }
      m.cells.peak.textContent = peak < 0.5 ? "ほぼ無し" : "+" + peak.toFixed(1) + " dB";
      m.cells.peak.style.color = peak > 3 ? "#b04a00" : "#2c6e2c";
      const iN = fs.findIndex((f) => f >= 8000);
      m.cells.ph.textContent = phc[iN].toFixed(0) + " deg";
      m.cells.hint.textContent = Ki < 0.3 ? "Type-3 が必要" : "Type-2 でOKに";
    }

    sKi.onInput(redraw);
    redraw();
  }

  return { conv, series, bodezpk, nyq, fbstep, gvd, openload, loopdesign, closedtrans, rhpz, cmc };
})();
