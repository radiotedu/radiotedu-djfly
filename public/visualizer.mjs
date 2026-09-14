export class MusicVisualizer {
  constructor(canvas, { mixer, onFailure = () => {} }) {
    this.canvas = canvas; this.mixer = mixer; this.onFailure = onFailure; this.enabled = true; this.preset = 'orbit';
    this.frames = 0; this.totalMs = 0; this.maxMs = 0; this.lowDetail = false; this.last = 0;
    this.frequency = new Uint8Array(512); this.wave = new Uint8Array(1024); this.wave.fill(128);
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { this.context = canvas.getContext('2d', { alpha: false }); if (!this.context) throw new Error('Canvas unavailable.'); }
    catch { this.fail(); }
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(canvas);
    this.visibility = () => { if (!document.hidden) this.schedule(); };
    document.addEventListener('visibilitychange', this.visibility);
    this.resize(); this.schedule();
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, rect.width < 700 ? 1.5 : 2);
    this.canvas.width = Math.max(1, Math.floor(rect.width * ratio)); this.canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  }
  schedule() { if (!this.frame && this.enabled && !document.hidden && this.context) this.frame = requestAnimationFrame(t => this.draw(t)); }
  setEnabled(enabled) { this.enabled = enabled; if (!enabled) { cancelAnimationFrame(this.frame); this.frame = null; } else this.schedule(); }
  fail() { this.enabled = false; cancelAnimationFrame(this.frame); this.frame = null; this.onFailure(); }
  draw(time) {
    this.frame = null;
    if (!this.enabled || document.hidden) return;
    const interval = this.reduced ? 200 : this.lowDetail ? 50 : 33;
    if (time - this.last < interval) return this.schedule();
    this.last = time;
    const started = performance.now();
    try {
      const ctx = this.context, width = this.canvas.width, height = this.canvas.height;
      const analyser = this.mixer.enabled && this.mixer.context?.state === 'running' ? this.mixer.analyser : null;
      if (analyser) { analyser.getByteFrequencyData(this.frequency); analyser.getByteTimeDomainData(this.wave); }
      else { this.frequency.fill(0); this.wave.fill(128); }
      const bass = this.frequency.slice(1, 24).reduce((a, b) => a + b, 0) / (23 * 255);
      ctx.fillStyle = '#0e0e0f'; ctx.fillRect(0, 0, width, height);
      const centerX = width * .5, centerY = height * .5, radius = Math.min(width * .29, height * .37);
      const telemetry = this.telemetry, neural = telemetry?.nodes?.length > 0;
      const showOff = telemetry?.readouts?.showOff ?? 0;
      const layers = this.lowDetail ? 4 : 7;
      if (this.preset !== 'network') for (let layer = 0; layer < layers; layer++) {
        ctx.beginPath();
        const points = this.lowDetail ? 96 : 192;
        for (let i = 0; i <= points; i++) {
          const angle = i / points * Math.PI * 2;
          const wave = (this.wave[Math.floor(i / points * 1023)] - 128) / 128;
          const spectral = this.frequency[Math.floor(i / points * 170)] / 255;
          let x, y;
          if (this.preset === 'wave') {
            x = width * .08 + i / points * width * .84;
            y = centerY + wave * height * .27 * (1 - layer * .09) + (layer - layers / 2) * height * .034;
          } else {
            const r = radius + layer * radius * .07 + wave * radius * .12 + spectral * radius * .12 * (1 + showOff * .25);
            x = centerX + Math.cos(angle) * r * 1.33; y = centerY + Math.sin(angle) * r * .74;
          }
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = layer === 0 ? `rgba(227,30,38,${.55 + bass * .4})` : `rgba(231,229,220,${.08 + (layers - layer) * .025})`;
        ctx.lineWidth = layer === 0 ? 2 : 1; ctx.stroke();
      }
      if (neural) {
        const nodes = telemetry.nodes.slice(0, this.lowDetail ? 48 : 132), positions = new Map();
        nodes.forEach(node => {
          const angle = node.y * Math.PI * 2 - Math.PI / 2;
          const r = radius * (.72 + node.x * .58);
          positions.set(node.id, { x: centerX + Math.cos(angle) * r * 1.35, y: centerY + Math.sin(angle) * r * .87, node });
        });
        for (const edge of telemetry.edges.slice(0, this.lowDetail ? 40 : 120)) {
          const a = positions.get(edge.source), b = positions.get(edge.target); if (!a || !b) continue;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(213,207,196,${edge.activity * (this.preset === 'network' ? .28 : .055)})`; ctx.lineWidth = 1; ctx.stroke();
        }
        for (const { x, y, node } of positions.values()) {
          ctx.beginPath(); ctx.arc(x, y, (node.role === 'output' ? 2.6 : 1.6) * (1 + bass * .3), 0, Math.PI * 2);
          ctx.fillStyle = node.stimulus > 0 ? `rgba(227,30,38,${node.activity * .8})` : `rgba(241,237,228,${node.activity * .65})`; ctx.fill();
        }
      }
      if (analyser) {
        const count = this.lowDetail ? 30 : 52, gap = width * .004, bandWidth = (width * .66) / count;
        for (let i = 0; i < count; i++) {
          const value = this.frequency[Math.floor(1 + i ** 1.35)] / 255;
          ctx.fillStyle = `rgba(227,30,38,${.2 + value * .5})`;
          ctx.fillRect(width * .17 + i * bandWidth, height * .84 - value * height * .07, bandWidth - gap, Math.max(1, value * height * .07));
        }
      }
      const elapsed = performance.now() - started;
      this.frames++; this.totalMs += elapsed; this.maxMs = Math.max(this.maxMs, elapsed);
      if (this.frames > 30 && this.totalMs / this.frames > 10) this.lowDetail = true;
    } catch { return this.fail(); }
    this.schedule();
  }
  stats() { return { frames: this.frames, meanDrawMs: this.frames ? this.totalMs / this.frames : 0, maxDrawMs: this.maxMs, lowDetail: this.lowDetail }; }
  close() { this.setEnabled(false); this.resizeObserver.disconnect(); document.removeEventListener('visibilitychange', this.visibility); }
}
