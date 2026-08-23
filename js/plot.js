/* 簡易プロットライブラリ(canvas 描画・線形/対数軸対応) */
"use strict";

class Plot {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts {xmin,xmax,ymin,ymax,xlabel,ylabel,title,xlog}
   */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.opts = Object.assign(
      { xmin: 0, xmax: 10, ymin: 0, ymax: 2, xlabel: "", ylabel: "", title: "", xlog: false },
      opts
    );
    this.margin = { left: 62, right: 16, top: opts.title ? 34 : 16, bottom: 46 };
    this._setupCanvas();
  }

  _setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width || this.canvas.clientWidth || 600;
    const cssH = this.canvas.getAttribute("height-css")
      ? parseFloat(this.canvas.getAttribute("height-css"))
      : (parseFloat(this.canvas.dataset.h) || 340);
    this.canvas.width = cssW * dpr;
    this.canvas.height = cssH * dpr;
    this.canvas.style.height = cssH + "px";
    this.ctx = this.canvas.getContext("2d");
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = cssW;
    this.H = cssH;
  }

  setRange(xmin, xmax, ymin, ymax) {
    this.opts.xmin = xmin; this.opts.xmax = xmax;
    this.opts.ymin = ymin; this.opts.ymax = ymax;
  }

  _tx(x) {
    const { xmin, xmax, xlog } = this.opts;
    const { left, right } = this.margin;
    const w = this.W - left - right;
    if (xlog) {
      const lx = Math.log10(x), l0 = Math.log10(xmin), l1 = Math.log10(xmax);
      return left + ((lx - l0) / (l1 - l0)) * w;
    }
    return left + ((x - xmin) / (xmax - xmin)) * w;
  }

  _ty(y) {
    const { ymin, ymax } = this.opts;
    const { top, bottom } = this.margin;
    const h = this.H - top - bottom;
    return top + (1 - (y - ymin) / (ymax - ymin)) * h;
  }

  /** 「切りのよい」目盛り間隔 */
  static _niceStep(span, target) {
    const raw = span / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) {
      if (raw <= m * mag) return m * mag;
    }
    return 10 * mag;
  }

  clear() {
    const ctx = this.ctx;
    const { xmin, xmax, ymin, ymax, xlog, xlabel, ylabel, title } = this.opts;
    const { left, right, top, bottom } = this.margin;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, this.W, this.H);

    const x0 = left, x1 = this.W - right, y0 = top, y1 = this.H - bottom;

    // グリッドと目盛り
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#555";
    ctx.strokeStyle = "#e2e6ea";
    ctx.lineWidth = 1;

    if (xlog) {
      const d0 = Math.ceil(Math.log10(xmin) - 1e-9);
      const d1 = Math.floor(Math.log10(xmax) + 1e-9);
      for (let d = Math.floor(Math.log10(xmin)); d <= d1; d++) {
        for (let m = 1; m <= 9; m++) {
          const v = m * Math.pow(10, d);
          if (v < xmin * 0.999 || v > xmax * 1.001) continue;
          const px = this._tx(v);
          ctx.strokeStyle = m === 1 ? "#ccd3da" : "#eef1f4";
          ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
          if (m === 1) {
            ctx.textAlign = "center";
            const label = d >= 0 && d <= 3 ? String(Math.pow(10, d)) : "10^" + d;
            ctx.fillText(label, px, y1 + 16);
          }
        }
      }
    } else {
      const step = Plot._niceStep(xmax - xmin, 8);
      for (let v = Math.ceil(xmin / step) * step; v <= xmax + 1e-9; v += step) {
        const px = this._tx(v);
        ctx.strokeStyle = "#eef1f4";
        ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
        ctx.textAlign = "center";
        ctx.fillText(this._fmt(v, step), px, y1 + 16);
      }
    }

    const ystep = Plot._niceStep(ymax - ymin, 6);
    for (let v = Math.ceil(ymin / ystep) * ystep; v <= ymax + 1e-9; v += ystep) {
      const py = this._ty(v);
      ctx.strokeStyle = Math.abs(v) < 1e-12 ? "#b9c2cb" : "#eef1f4";
      ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(this._fmt(v, ystep), x0 - 6, py + 4);
    }

    // 枠
    ctx.strokeStyle = "#8a939c";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

    // 軸ラベル・タイトル
    ctx.fillStyle = "#333";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    if (xlabel) ctx.fillText(xlabel, (x0 + x1) / 2, this.H - 8);
    if (ylabel) {
      ctx.save();
      ctx.translate(14, (y0 + y1) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(ylabel, 0, 0);
      ctx.restore();
    }
    if (title) {
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(title, (x0 + x1) / 2, 20);
    }
  }

  _fmt(v, step) {
    if (Math.abs(v) < 1e-12) return "0";
    const dec = Math.max(0, -Math.floor(Math.log10(step)) + (step / Math.pow(10, Math.floor(Math.log10(step))) < 1.5 ? 0 : 0));
    return v.toFixed(Math.min(6, Math.max(0, dec)));
  }

  /** 折れ線を描画。xs, ys は同じ長さの配列 */
  line(xs, ys, color = "#1a5fb4", width = 2, dash = []) {
    const ctx = this.ctx;
    const { xmin, xmax, ymin, ymax } = this.opts;
    ctx.save();
    // プロット領域でクリップ
    ctx.beginPath();
    ctx.rect(this.margin.left, this.margin.top,
      this.W - this.margin.left - this.margin.right,
      this.H - this.margin.top - this.margin.bottom);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i], y = ys[i];
      if (!isFinite(x) || !isFinite(y)) { started = false; continue; }
      const px = this._tx(x), py = this._ty(y);
      if (!started) { ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 多角形の塗りつぶし(面積の可視化用) */
  fillPoly(xs, ys, fillColor, strokeColor = null) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.margin.left, this.margin.top,
      this.W - this.margin.left - this.margin.right,
      this.H - this.margin.top - this.margin.bottom);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(this._tx(xs[0]), this._ty(ys[0]));
    for (let i = 1; i < xs.length; i++) {
      ctx.lineTo(this._tx(xs[i]), this._ty(ys[i]));
    }
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** サンプル点のマーカー描画 */
  points(xs, ys, color = "#1a5fb4", r = 3) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.margin.left, this.margin.top,
      this.W - this.margin.left - this.margin.right,
      this.H - this.margin.top - this.margin.bottom);
    ctx.clip();
    ctx.fillStyle = color;
    for (let i = 0; i < xs.length; i++) {
      if (!isFinite(xs[i]) || !isFinite(ys[i])) continue;
      ctx.beginPath();
      ctx.arc(this._tx(xs[i]), this._ty(ys[i]), r, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }

  hline(y, color = "#999", dash = [5, 4]) {
    this.line([this.opts.xmin, this.opts.xmax], [y, y], color, 1.2, dash);
  }

  vline(x, color = "#999", dash = [5, 4]) {
    this.line([x, x], [this.opts.ymin, this.opts.ymax], color, 1.2, dash);
  }

  label(x, y, text, color = "#333") {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(text, this._tx(x) + 4, this._ty(y) - 4);
  }
}

/* スライダー登録ヘルパー: 値表示の更新とコールバック */
function bindSlider(id, onChange, fmt = (v) => v) {
  const el = document.getElementById(id);
  const valEl = document.querySelector(`label[for="${id}"] .value`);
  const update = () => {
    const v = parseFloat(el.value);
    if (valEl) valEl.textContent = fmt(v);
    onChange(v);
  };
  el.addEventListener("input", update);
  update();
  return el;
}
