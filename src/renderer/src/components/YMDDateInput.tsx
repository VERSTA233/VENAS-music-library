import { useEffect, useRef, useState } from 'react'

interface YMDDateInputProps {
  value: string
  onChange: (next: string) => void
  className?: string
}

function pad2(s: string): string {
  return s.padStart(2, '0')
}

function splitValue(value: string): { y: string; m: string; d: string } {
  if (!value) return { y: '', m: '', d: '' }
  const [y = '', m = '', d = ''] = value.split('-')
  return { y, m: m.length === 1 ? pad2(m) : m, d: d.length === 1 ? pad2(d) : d }
}

/* 保留用户已填写的日期精度：年、年月、完整年月日分别存为 YYYY、YYYY-MM、YYYY-MM-DD。 */
function combine(y: string, m: string, d: string): string {
  if (!y) return ''
  if (!m) return y
  if (!d) return `${y}-${pad2(m)}`
  return `${y}-${pad2(m)}-${pad2(d)}`
}

const inputClass =
  'bg-white/5 border border-white/10 rounded px-1.5 py-1 text-sm text-center outline-none focus:border-white/30'

/* 年/月/日三个独立输入框，内部按已填写精度拼接，对外仍是单个受控 string。 */
export default function YMDDateInput({ value, onChange, className }: YMDDateInputProps): React.JSX.Element {
  const [y, setY] = useState(() => splitValue(value).y)
  const [m, setM] = useState(() => splitValue(value).m)
  const [d, setD] = useState(() => splitValue(value).d)
  /* 只在 value 变化并非来自本组件自身 onChange 回声时才重新拆分同步，避免拼接补零打断用户正在输入的原始数字 */
  const lastEmitted = useRef(value)

  useEffect(() => {
    if (value === lastEmitted.current) return
    const parts = splitValue(value)
    setY(parts.y)
    setM(parts.m)
    setD(parts.d)
    lastEmitted.current = value
  }, [value])

  function emit(nextY: string, nextM: string, nextD: string): void {
    const combined = combine(nextY, nextM, nextD)
    lastEmitted.current = combined
    onChange(combined)
  }

  function normalizeMonth(): void {
    if (m.length !== 1) return
    const normalized = pad2(m)
    setM(normalized)
    emit(y, normalized, d)
  }

  function normalizeDay(): void {
    if (d.length !== 1) return
    const normalized = pad2(d)
    setD(normalized)
    emit(y, m, normalized)
  }

  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
      <input
        value={y}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 4)
          setY(digits)
          emit(digits, m, d)
        }}
        placeholder="YYYY"
        className={`${inputClass} w-14`}
      />
      <span className="text-neutral-500">-</span>
      <input
        value={m}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 2)
          setM(digits)
          emit(y, digits, d)
        }}
        onBlur={normalizeMonth}
        placeholder="MM"
        className={`${inputClass} w-10`}
      />
      <span className="text-neutral-500">-</span>
      <input
        value={d}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 2)
          setD(digits)
          emit(y, m, digits)
        }}
        onBlur={normalizeDay}
        placeholder="DD"
        className={`${inputClass} w-10`}
      />
    </div>
  )
}
