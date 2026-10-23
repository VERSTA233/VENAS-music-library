/* 全应用颜色库：Electron 窗口和网页界面共用。修改这里即可调整配色，无需逐个组件修改。 */
const neutrals = {
  'neutral-100': 'oklch(97% 0 0)',
  'neutral-200': 'oklch(92.2% 0 0)',
  'neutral-300': 'oklch(87% 0 0)',
  'neutral-400': 'oklch(70.8% 0 0)',
  'neutral-500': 'oklch(55.6% 0 0)',
  'neutral-600': 'oklch(43.9% 0 0)',
  'neutral-700': 'oklch(37.1% 0 0)',
  'neutral-800': 'oklch(26.9% 0 0)',
  'neutral-900': 'oklch(20.5% 0 0)',
  'neutral-950': 'oklch(14.5% 0 0)'
} as const

export const colors = {
  ...neutrals,
  white: '#ffffff',
  black: '#000000',
  // 背景与材质，保留现有暗色层次。
  app: '#0e0e10',
  sidebar: '#151518',
  content: '#101012',
  panel: '#1b1b1f',
  menu: '#242428',
  player: '#101114',
  tooltip: '#25262b',
  dialog: '#1a1a1e',
  queue: '#17181c',
  'solid-surface': '#171719',
  toolbar: 'rgba(20, 20, 23, 0.76)',
  // 所有 input / textarea 的占位引导文字只使用 placeholder。
  placeholder: neutrals['neutral-500'],
  foreground: '#f4f4f5',
  icon: '#a1a1aa',
  'icon-hover': 'rgba(255, 255, 255, 0.1)',
  scrollbar: 'rgba(255, 255, 255, 0.22)',
  'scrollbar-hover': 'rgba(255, 255, 255, 0.36)',
  'progress-track': 'rgba(255, 255, 255, 0.22)',
  'progress-fill': 'rgba(255, 255, 255, 0.92)',
  'progress-shadow': 'rgba(0, 0, 0, 0.35)',
  // 状态色：同时供文字、边框及带透明度的背景使用。
  'red-100': 'oklch(93.6% 0.032 17.717)',
  'red-200': 'oklch(88.5% 0.062 18.334)',
  'red-300': 'oklch(80.8% 0.114 19.571)',
  'red-400': 'oklch(70.4% 0.191 22.216)',
  'red-500': 'oklch(63.7% 0.237 25.331)',
  'amber-200': 'oklch(92.4% 0.12 95.746)',
  'amber-300': 'oklch(87.9% 0.169 91.605)',
  'amber-400': 'oklch(82.8% 0.189 84.429)',
  'amber-500': 'oklch(76.9% 0.188 70.08)',
  'green-500': 'oklch(72.3% 0.219 149.579)',
  'yellow-500': 'oklch(79.5% 0.184 86.047)',
  'emerald-500': 'oklch(69.6% 0.17 162.48)'
} as const
