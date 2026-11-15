// Accessible line chart: pointer and keyboard inspection, an optional dashed reference line (e.g. a
// 30-day high), an optional benchmark, and a plain-language summary for screen readers.
import { useMemo, useRef, useState } from 'react';
import { dateFmt, priceFmt, signedPct } from '../lib/format';

export interface Point { date: string; value: number }

export function LineChart({ points, bench, refLine, height = 260, label, format = priceFmt, benchLabel }: {
  points: Point[]; bench?: Point[]; refLine?: { value: number; label: string } | null; height?: number; label: string; format?: (v: number) => string; benchLabel?: string;
}) {
  const W = 760, H = height, padL = 8, padR = 52, padT = 14, padB = 24;
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const { min, max, path, x, y, ticks } = useMemo(() => {
    const vals = [...points.map(p => p.value), ...(bench ?? []).map(p => p.value), ...(refLine ? [refLine.value] : [])];
    let min = Math.min(...vals), max = Math.max(...vals);
    const pad = (max - min) * 0.08 || max * 0.02 || 1; min -= pad; max += pad;
    const x = (i: number, n = points.length) => padL + (n <= 1 ? 0 : i / (n - 1)) * (W - padL - padR);
    const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    const ticks = Array.from({ length: 4 }, (_, i) => min + (max - min) * (i + 0.5) / 4);
    return { min, max, path, x, y, ticks };
  }, [points, bench, refLine, H]);
  if (points.length < 2) return <p className="faint">Not enough history to draw a chart.</p>;
  void min; void max;
  const first = points[0], last = points[points.length - 1];
  const up = last.value >= first.value;
  const hi = points.reduce((a, b) => (b.value > a.value ? b : a)), lo = points.reduce((a, b) => (b.value < a.value ? b : a));
  const summary = `${label}: ${up ? 'up' : 'down'} ${signedPct(((last.value / first.value) - 1) * 100)} from ${format(first.value)} on ${dateFmt(first.date)} to ${format(last.value)} on ${dateFmt(last.date)}. High ${format(hi.value)} on ${dateFmt(hi.date)}; low ${format(lo.value)} on ${dateFmt(lo.date)}.`;
  const benchPath = bench && bench.length > 1 ? bench.map((p, i) => `${i ? 'L' : 'M'}${x(i, bench.length).toFixed(1)},${y(p.value).toFixed(1)}`).join('') : null;
  const at = hover == null ? null : points[hover];
  const pick = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - padL) / (W - padL - padR)) * (points.length - 1)))));
  };
  const labels = [0, Math.floor(points.length / 3), Math.floor(points.length * 2 / 3), points.length - 1];
  return (
    <figure className="chart" style={{ margin: 0 }} ref={box}
      tabIndex={0} aria-label={`${summary} Use the left and right arrow keys to read values.`}
      onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setHover(h => Math.max(0, Math.min(points.length - 1, (h ?? points.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)))); } if (e.key === 'Escape') setHover(null); }}
      onPointerMove={e => pick(e.clientX)} onPointerDown={e => pick(e.clientX)} onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden>
        <g className="grid">{ticks.map((t, i) => <line key={i} x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />)}</g>
        <g className="axis">{ticks.map((t, i) => <text key={i} x={W - padR + 6} y={y(t) + 4}>{format(t)}</text>)}
          {labels.map((i, k) => <text key={k} x={x(i)} y={H - 6} textAnchor={k === 0 ? 'start' : k === labels.length - 1 ? 'end' : 'middle'}>{dateFmt(points[i].date, { month: 'short', day: 'numeric', ...(points.length > 400 ? { year: '2-digit' } : {}) })}</text>)}</g>
        {refLine && <g><line className="ref" x1={padL} x2={W - padR} y1={y(refLine.value)} y2={y(refLine.value)} /><text className="ref-label" x={W - padR - 4} y={y(refLine.value) - 6} textAnchor="end">{refLine.label}</text></g>}
        {benchPath && <path className="line bench" d={benchPath} />}
        <path className={`line ${up ? '' : 'down'}`} d={path} />
        {at && <g><line className="cursor" x1={x(hover!)} x2={x(hover!)} y1={padT} y2={H - padB} /><circle className="dot" cx={x(hover!)} cy={y(at.value)} r={4} /></g>}
      </svg>
      {at && <div className="chart-tip" style={{ left: `${(x(hover!) / W) * 100}%` }}><b className="num">{format(at.value)}</b> <span className="faint">{dateFmt(at.date)}</span></div>}
      <figcaption className="sr-only">{summary}{benchLabel ? ` Dashed line: ${benchLabel}.` : ''}</figcaption>
    </figure>
  );
}
