import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
// const api = {} // Remove unused api object

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    // Expose protected methods that allow the renderer process to use
    // the ipcRenderer without exposing the entire object
    contextBridge.exposeInMainWorld('ipc', { // Expose under 'ipc'
      send: (channel, data) => {
        console.log('[Preload Send] Received in preload - Channel:', channel, 'Data:', data); // Log within preload
        ipcRenderer.send(channel, data);
      },
      on: (channel, func) => {
        // Deliberately strip event as it includes `sender`
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      },
      removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel) // Expose removeAllListeners
    })
    // contextBridge.exposeInMainWorld('electron', electronAPI) // Remove default electronAPI exposure if not needed elsewhere
    // contextBridge.exposeInMainWorld('api', api) // Remove unused api object exposure
  } catch (error) {
    console.error(error)
  }
} else {
  // window.electron = electronAPI // Avoid exposing if contextIsolation is off
  // window.api = api // Avoid exposing if contextIsolation is off
  // For contextIsolation: false, you might need a different approach or ensure it's enabled.
  // Directly exposing ipcRenderer is generally discouraged for security reasons.
  console.warn('Context Isolation is disabled. Preload script did not expose IPC functions securely.')
}
