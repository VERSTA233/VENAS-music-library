// 故障注入只作用于独立测试子进程，不改变应用或真实音乐文件。
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const [operation, mode, source, destination] = process.argv.slice(2)
const originalOpen = fs.open.bind(fs)
const originalRename = fs.rename.bind(fs)
const originalAppendFile = fs.appendFile.bind(fs)
function error(code) { return Object.assign(new Error(`Injected ${code}`), { code }) }
async function checkpoint(stage) {
  process.send?.({ stage })
  // 父进程收到检查点后 SIGKILL；保持进程存活以模拟真正的强制退出。
  await new Promise(() => { setInterval(() => {}, 1000) })
}
let written = 0
fs.open = async (...args) => {
  const handle = await originalOpen(...args)
  if (operation === 'write' && args[0] === destination) {
    const originalWrite = handle.write.bind(handle)
    handle.write = async (...writeArgs) => {
      if (written > 128) {
        if (mode === 'kill-write') await checkpoint('partial-output')
        if (mode === 'ENOSPC' || mode === 'EIO') throw error(mode)
      }
      const result = await originalWrite(...writeArgs)
      written += result.bytesWritten
      return result
    }
  }
  if (operation === 'apply' && String(args[0]).includes('.venas-tag-test-') && args[1] === 'r+') {
    const originalSync = handle.sync.bind(handle)
    handle.sync = async () => {
      if (mode === 'sync-fails') throw error('EIO')
      await originalSync()
      if (mode === 'source-changes') await originalAppendFile(destination, 'External edit during staging')
    }
  }
  return handle
}
fs.rename = async (...args) => {
  if (mode === 'rename-fails') throw error('EACCES')
  if (mode === 'kill-before-rename') await checkpoint('before-rename')
  const result = await originalRename(...args)
  if (mode === 'kill-after-rename') await checkpoint('after-rename')
  return result
}
syncBuiltinESMExports()

try {
  if (operation === 'write') {
    const { writeFlacTagCopy } = await import('../src/main/library/flacTags.ts')
    await writeFlacTagCopy(source, destination, { TITLE: 'Updated title' })
  } else if (operation === 'apply') {
    process.argv = [process.execPath, resolve('tests/helpers/applyFlacTagFixture.mjs'), source, destination]
    await import(pathToFileURL(resolve('tests/helpers/applyFlacTagFixture.mjs')))
  } else throw new Error('Unknown operation')
} catch (reason) {
  console.error(reason.code ?? '', reason.message)
  process.exitCode = 1
}
