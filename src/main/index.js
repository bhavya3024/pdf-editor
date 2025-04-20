import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
// import fs from 'fs' // Remove unused fs import
import fs from 'fs'

let mainWindow

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // IPC handler for receiving PDF *content*
  ipcMain.on('open-pdf-content', (event, pdfContent) => {
    console.log('Received open-pdf-content request.');
    // The pdfContent received here should be a Buffer
    // console.log('Received Buffer type:', Buffer.isBuffer(pdfContent)); // Optional: check type

    if (pdfContent) {
      console.log('Received PDF content (Buffer), sending data back to renderer');
      // Send the raw buffer data back to the renderer process
      // No need to read from fs anymore
      mainWindow.webContents.send('pdf-data', pdfContent) // Send the buffer directly
    } else {
      console.error('Received empty PDF content');
      mainWindow.webContents.send('pdf-error', 'Received empty PDF content');
    }
    // Remove old try/catch block for fs.readFileSync
    /*
    try {
      const pdfData = fs.readFileSync(filePath)
      console.log('Successfully read PDF file, sending data to renderer');
      mainWindow.webContents.send('pdf-data', pdfData)
    } catch (error) {
      console.error('Failed to read PDF file:', error)
      mainWindow.webContents.send('pdf-error', error.message)
    }
    */
  })

  // IPC handler for saving the modified PDF
  ipcMain.on('save-pdf-dialog', async (event, pdfBytes) => {
    if (!mainWindow) return;
    console.log('Received save-pdf-dialog request.');

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Modified PDF',
      defaultPath: `modified_document.pdf`, 
      filters: [
        { name: 'PDF Documents', extensions: ['pdf'] }
      ]
    });

    if (!canceled && filePath) {
      console.log(`Attempting to save PDF to: ${filePath}`);
      try {
        fs.writeFileSync(filePath, pdfBytes); // Write the buffer directly
        console.log(`Successfully saved PDF to ${filePath}`);
        // Optionally, send a success message back to the renderer
        // event.sender.send('save-pdf-success', filePath);
      } catch (error) {
        console.error('Failed to save PDF file:', error);
        // Optionally, send an error message back to the renderer
        // event.sender.send('save-pdf-error', error.message);
      }
    } else {
      console.log('PDF save dialog cancelled.');
    }
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
