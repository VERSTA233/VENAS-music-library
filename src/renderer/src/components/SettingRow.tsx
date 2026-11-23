export default function SettingRow({ icon, title, description, action, actionIcon, onClick, disabled = false }: { icon: React.ReactNode; title: string; description: string; action: string; actionIcon?: React.ReactNode; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <div className="flex min-h-22 items-center gap-4 px-5 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-neutral-300">{icon}</div>
      <div className="min-w-0 flex-1"><div className="text-sm font-medium text-neutral-100">{title}</div><div className="mt-1 truncate text-xs text-neutral-500" title={description}>{description}</div></div>
      <button type="button" onClick={onClick} disabled={disabled} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.1] px-3 py-2 text-xs font-medium text-neutral-200 transition hover:bg-white/[0.17] hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">{actionIcon}{action}</button>
    </div>
  )
}
