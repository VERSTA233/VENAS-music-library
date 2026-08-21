import { Shuffle } from 'lucide-react'

interface RandomPlayButtonProps {
  onClick: () => void
  disabled?: boolean
}

/* 在当前页面曲目范围内立即随机播放；与底部播放条的随机模式按钮保持同一图标语义。 */
export default function RandomPlayButton({ onClick, disabled = false }: RandomPlayButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="library-icon-button disabled:cursor-not-allowed disabled:opacity-30"
      title="随机播放当前列表"
      aria-label="随机播放当前列表"
    >
      <Shuffle size={16} />
    </button>
  )
}
