import { build } from 'esbuild'
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import electron from 'electron'

const entry = process.argv[2]
if (!entry) throw new Error('Usage: node scripts/test-ui.mjs <test entry> [--audio] [--app-styles] [Electron switches]')
const audio = process.argv.includes('--audio')
const appStyles = process.argv.includes('--app-styles')
const switches = process.argv.slice(3).filter(arg => arg !== '--audio' && arg !== '--app-styles')
const directory = await mkdtemp(join(tmpdir(), 'venas-ui-test-'))
try {
  const renderer = join(directory, 'renderer.js')
  await build({ entryPoints: [entry], outfile: renderer, bundle: true,
    platform: 'browser', format: 'iife', globalName: 'uiTest', jsx: 'automatic' })
  const audioOutput = join(directory, 'audio-output.cjs')
  if (audio) await build({ entryPoints: ['src/main/audioOutput.ts'], outfile: audioOutput, bundle: true, platform: 'node', format: 'cjs' })
  const main = join(directory, 'main.cjs')
  let stylesheet = join(directory, 'renderer.css')
  if (appStyles) {
    const css = (await readdir('out/renderer/assets')).find(file => file.endsWith('.css'))
    if (!css) throw new Error('Run npm run build before testing application styles')
    stylesheet = join(resolve('out/renderer/assets'), css)
  }
  await writeFile(main, `
    const { app, BrowserWindow } = require('electron');
    const { readFileSync, existsSync } = require('node:fs');
    ${audio ? `require(${JSON.stringify(audioOutput)}).configureAudioOutput(app.commandLine);
      app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');` : ''}
    app.setPath('userData', ${JSON.stringify(join(directory, 'user-data'))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: ${appStyles ? 1280 : 800}, height: ${appStyles ? 800 : 600}, webPreferences: { backgroundThrottling: false } });
      try {
        await window.loadURL('data:text/html,<html><body></body></html>');
        const stylesheet = ${JSON.stringify(stylesheet)};
        if (existsSync(stylesheet)) await window.webContents.insertCSS(readFileSync(stylesheet, 'utf8'));
        await window.webContents.executeJavaScript(readFileSync(${JSON.stringify(renderer)}, 'utf8'));
        console.log(JSON.stringify(await window.webContents.executeJavaScript('uiTest.result')));
        window.destroy(); app.quit();
      } catch (error) { console.error(error); app.exit(1); }
    });
  `)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(electron, [...switches, main], { stdio: 'inherit', env })
    const timeout = setTimeout(() => { child.kill(); reject(new Error('UI test timed out')) }, audio ? 30000 : 20000)
    child.on('error', (error) => { clearTimeout(timeout); reject(error) })
    child.on('exit', (code, signal) => {
      clearTimeout(timeout)
      if (signal) reject(new Error(`Electron UI test terminated by ${signal}`))
      else resolve(code ?? 1)
    })
  })
} finally { await rm(directory, { recursive: true, force: true }) }
