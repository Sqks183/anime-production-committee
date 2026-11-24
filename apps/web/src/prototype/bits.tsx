import type { ReactNode } from 'react'
import { markNames, riskNames } from './model'
import type { Mark, RiskLevel } from './model'

export const money = (value: number) => Math.abs(value).toLocaleString('zh-CN')
export const yuan = (value: number) => `${value < 0 ? '-' : ''}¥${money(value)}`
export const signedYuan = (value: number) => `${value > 0 ? '+' : value < 0 ? '-' : '±'}¥${money(value)}`
export const signedPoint = (value: number) => `${value > 0 ? '+' : value < 0 ? '-' : '±'}${Math.abs(value)}`

export function Marks({ marks }: { marks: Mark[] }) {
  return <span className="proto-marks">{marks.map((mark) => <span key={mark} className={`mark mark-${mark}`}>{markNames[mark]}</span>)}</span>
}

export function RiskTag({ level, label }: { level: RiskLevel; label?: string }) {
  return <span className={`risk risk-${level}`}>{label ?? riskNames[level]}</span>
}

export function Bar({ value, max = 100, tone }: { value: number; max?: number; tone?: 'lead' | 'behind' | 'neutral' }) {
  return <progress className={`proto-bar${tone ? ` proto-bar-${tone}` : ''}`} value={Math.round((value / max) * 100)} max={100} />
}

export function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return <div className="proto-stat"><dt>{label}</dt><dd className={strong ? 'stat-strong' : undefined}>{value}</dd>{hint && <p className="stat-hint">{hint}</p>}</div>
}

export function Panel({ eyebrow, title, note, marks, children, aside }: {
  eyebrow: string; title: string; note?: string; marks?: Mark[]; children: ReactNode; aside?: ReactNode
}) {
  return <section className="proto-panel" aria-label={title}>
    <header className="proto-panel-head">
      <div><p className="eyebrow">{eyebrow}</p><h2>{title}{marks && <Marks marks={marks} />}</h2></div>
      {aside}
    </header>
    {note && <p className="proto-panel-note">{note}</p>}
    {children}
  </section>
}
