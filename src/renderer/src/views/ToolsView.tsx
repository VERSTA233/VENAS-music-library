import { useEffect, useState } from 'react'
import SettingsPage from '../components/SettingsPage'
import PlaylistExportSettings from '../components/PlaylistExportSettings'
import AudioTagWriteSettings from '../components/AudioTagWriteSettings'

export default function ToolsView(): React.JSX.Element {
  const [musicRoot, setMusicRoot] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { window.api.library.getRoots().then(roots => setMusicRoot(roots.musicRoot)).catch(reason => setError(String(reason))) }, [])
  return <SettingsPage title="Tools">
    <PlaylistExportSettings musicRoot={musicRoot} />
    <AudioTagWriteSettings />
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
  </SettingsPage>
}
