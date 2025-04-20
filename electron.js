const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ... (createWindow function)

app.whenReady().then(() => {
  createWindow();
  // ... (app activation logic)
});

// --- IPC Handlers ---

// Handle opening PDF content (existing)
ipcMain.on('open-pdf-content', (event, fileContent) => {
  // Assuming fileContent is ArrayBuffer, send it back as Buffer/Uint8Array
  console.log('Main: Received open-pdf-content request.');
  event.sender.send('pdf-data', Buffer.from(fileContent));
});

// Handle Save PDF Dialog
ipcMain.on('save-pdf-dialog', async (event, pdfBytes) => {
  console.log('Main: Received save-pdf-dialog request.');

  // ---> Add Logs <---
  console.log(`Main: Received pdfBytes type: ${typeof pdfBytes}, isBuffer: ${Buffer.isBuffer(pdfBytes)}`);
  if (pdfBytes instanceof Uint8Array || Buffer.isBuffer(pdfBytes)) {
      console.log(`Main: Received pdfBytes length: ${pdfBytes.length}`);
  } else {
      console.log('Main: Received pdfBytes is NOT a Buffer or Uint8Array!');
  }
  // ---> End Logs <---

  const browserWindow = BrowserWindow.fromWebContents(event.sender);

  if (!browserWindow) {
    console.error('Main: Could not find browser window for save dialog.');
    return; 
  }

  const defaultPath = path.join(app.getPath('documents'), 'edited-pdf.pdf');

  try {
    console.log('Main: Showing save dialog...');
    const { canceled, filePath } = await dialog.showSaveDialog(browserWindow, {
      title: 'Save Edited PDF',
      defaultPath: defaultPath,
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    });

    if (!canceled && filePath) {
      console.log(`Main: Save dialog confirmed. File path: ${filePath}`);
      
      // Ensure pdfBytes is a Buffer for writeFileSync
      const bufferToWrite = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
      
      console.log(`Main: Writing buffer (length: ${bufferToWrite.length}) to file...`);
      fs.writeFileSync(filePath, bufferToWrite);
      console.log('Main: PDF saved successfully.');
    } else {
      console.log('Main: Save dialog cancelled.');
    }
  } catch (err) {
    console.error('Main: Error showing save dialog or writing file:', err);
  }
});

// --- End IPC Handlers ---

// ... (app quit logic) ... 