import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { colors } from '../../shared/colors'
import './assets/main.css'

// 在首次渲染前设置全局色值，组件及 CSS 工具类只引用相应颜色变量。
for (const [name, value] of Object.entries(colors)) {
  document.documentElement.style.setProperty(`--palette-${name}`, value)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
