import { BrowserWindow } from 'electron'

/** Send an event to every live renderer without letting a closed window interrupt the broadcast. */
export function broadcastToWindows(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send(channel, ...args)
  }
}
