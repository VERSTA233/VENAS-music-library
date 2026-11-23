export default function SettingsPage({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return <div className="flex h-full flex-col">
    <div className="library-toolbar sticky top-0 z-10 border-b border-white/[0.08]"><h1 className="text-xl font-semibold leading-tight">{title}</h1></div>
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7"><div className="w-full space-y-8">{children}</div></div>
  </div>
}
