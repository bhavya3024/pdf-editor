import { useState, useEffect } from 'react'
import * as pdfjsLib from 'pdfjs-dist/build/pdf'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import './App.css'
import PdfToolbar from './components/PdfToolbar'
import PdfViewer from './components/PdfViewer'

if (!pdfjsLib.GlobalWorkerOptions.workerPort) {
  pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker()
}

function App() {
  const [filePath, setFilePath] = useState('')
  const [pdfDoc, setPdfDoc] = useState(null)
  const [editMode, setEditMode] = useState('view')
  const [annotations, setAnnotations] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [originalPdfData, setOriginalPdfData] = useState(null)
  const [pageDimensions, setPageDimensions] = useState([])
  const [selectedFontSize] = useState(16)
  const [devicePixelRatio, setDevicePixelRatio] = useState(window.devicePixelRatio || 1)

  const handleFileChange = (event) => {
    const file = event.target.files[0]
    if (file) {
      console.log('Selected file object:', file)
      setFilePath(file.name)
      setAnnotations([])
      setEditMode('view')
      setPdfDoc(null)
      setError('')
      setIsLoading(true)
      setPageDimensions([])
      setOriginalPdfData(null)

      const reader = new FileReader()
      reader.onload = (e) => {
        const fileContent = e.target.result
        console.log('Read file content (ArrayBuffer), sending to main...')
        setOriginalPdfData(fileContent)
        window.ipc.send('open-pdf-content', fileContent)
      }
      reader.onerror = (error) => {
        console.error('FileReader error:', error)
        setError('Error reading file.')
        setIsLoading(false)
      }
      reader.readAsArrayBuffer(file)
    }
  }

  useEffect(() => {
    const handlePdfData = async (pdfDataArray) => {
      console.log('Received PDF data from main process')
      setError('')

      try {
        const loadingTask = pdfjsLib.getDocument({ data: pdfDataArray })
        const pdf = await loadingTask.promise
        console.log('PDF loaded')
        setPdfDoc(pdf)

        // Get dimensions sequentially using await in loop
        const pageDataArray = []
        console.log(`Fetching dimensions for ${pdf.numPages} pages sequentially...`)
        for (let i = 1; i <= pdf.numPages; i++) {
          console.log(`Getting page ${i}...`)
          const page = await pdf.getPage(i) // Await page here
          const viewport = page.getViewport({ scale: 1.5 })
          pageDataArray.push({
            pageNum: i,
            width: viewport.width,
            height: viewport.height
          })
        }
        console.log('Page dimensions loaded sequentially.')
        setPageDimensions(pageDataArray) // Set state after loop
      } catch (reason) {
        console.error('Error loading PDF document or dimensions:', reason)
        setError('Error loading PDF document.')
        setPdfDoc(null)
        setPageDimensions([])
      } finally {
        setIsLoading(false)
      }
    }

    const handlePdfError = (errorMessage) => {
      console.error('Received error from main:', errorMessage)
      setError(`Error opening PDF: ${errorMessage}`)
      setIsLoading(false)
      setPdfDoc(null)
    }

    window.ipc.on('pdf-data', handlePdfData)
    window.ipc.on('pdf-error', handlePdfError)

    return () => {
      window.ipc.removeAllListeners('pdf-data')
      window.ipc.removeAllListeners('pdf-error')
    }
  }, [])

  useEffect(() => {
    const updatePixelRatio = () => {
      const newRatio = window.devicePixelRatio || 1
      console.log('Device Pixel Ratio:', newRatio)
      setDevicePixelRatio(newRatio)
    }
    updatePixelRatio()
  }, [])

  const handleAnnotationAdd = (newAnnotation) => {
    setAnnotations((prev) => [...prev, newAnnotation])
  }

  const handleViewerError = (errorMessage) => {
    setError(errorMessage)
  }

  const handleSetEditMode = (mode) => {
    setEditMode(mode)
  }

  // Log state just before render
  console.log('[App Render] isLoading:', isLoading, 'pdfDoc:', pdfDoc ? 'Exists' : 'Null', 'pageDimensions length:', pageDimensions.length);

  // --- Save Logic ---
  const handleSavePdf = async () => {
    if (!originalPdfData || annotations.length === 0) {
      console.log('handleSavePdf: No PDF data or no annotations to save.');
      return;
    }

    console.log('handleSavePdf: Starting PDF save process...');
    console.log(`handleSavePdf: Processing ${annotations.length} annotations.`);
    setError('');
    setIsLoading(true); // Show loading indicator during save

    try {
      console.log('handleSavePdf: Loading original PDF data with pdf-lib...');
      const pdfDoc = await PDFDocument.load(originalPdfData);
      const embeddedFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      
      annotations.forEach((annotation, index) => {
        if (annotation.page > 0 && annotation.page <= pages.length) {
          const pageIndex = annotation.page - 1;
          const page = pages[pageIndex];
          // const { height: pdfPageHeight } = page.getSize(); // Get full size later

          // --- Coordinate Conversion (REVISED) ---
          // 1. Get CSS pixel coordinates (relative to canvas top-left)
          const cssX = annotation.x / devicePixelRatio;
          const cssY = annotation.y / devicePixelRatio;

          // 2. Get the dimensions used for display (from pdfjs viewport at scale 1.5)
          const pageDim = pageDimensions.find(p => p.pageNum === annotation.page);
          if (!pageDim) {
              console.warn(`handleSavePdf: Skipping annotation, cannot find page dimensions for page ${annotation.page}`);
              return; // Use continue equivalent in forEach (return)
          }
          const { width: displayWidth, height: displayHeight } = pageDim; // CSS dimensions

          // 3. Get the actual PDF page dimensions in points
          const { width: pdfPageWidth, height: pdfPageHeightActual } = page.getSize();

          // 4. Calculate mapping ratio from display CSS pixels to PDF points
          const ratioX = pdfPageWidth / displayWidth;
          const ratioY = pdfPageHeightActual / displayHeight;

          // 5. Map CSS coordinates to PDF points (relative to top-left first)
          const pdfPointX_TL = cssX * ratioX;
          const pdfPointY_TL = cssY * ratioY;

          // 6. Convert top-left PDF points to bottom-left PDF points for pdf-lib
          const pdfX = pdfPointX_TL;
          const pdfY = pdfPageHeightActual - pdfPointY_TL;
          // --- End Coordinate Conversion ---

          if (index === 0) {
             // Update log to show new coords
            console.log(`handleSavePdf: Annotation ${index+1} (${annotation.type}) - Canvas Coords (x,y): (${annotation.x.toFixed(2)}, ${annotation.y.toFixed(2)}), PDF Coords (x,y): (${pdfX.toFixed(2)}, ${pdfY.toFixed(2)}), Page Height: ${pdfPageHeightActual}`);
          }

          if (annotation.type === 'text') {
            page.drawText(annotation.text, {
              x: pdfX,
              y: pdfY - selectedFontSize / 1.5, // Adjust Y using scaled font size
              font: embeddedFont,
              size: selectedFontSize / 1.5, // Scale font size back to PDF points
              color: rgb(0, 0, 0),
            });
          } else if (annotation.type === 'cross') {
            const crossSize = 10;
            page.drawLine({ start: { x: pdfX - crossSize, y: pdfY - crossSize }, end: { x: pdfX + crossSize, y: pdfY + crossSize }, thickness: 2, color: rgb(0, 0, 0) });
            page.drawLine({ start: { x: pdfX + crossSize, y: pdfY - crossSize }, end: { x: pdfX - crossSize, y: pdfY + crossSize }, thickness: 2, color: rgb(0, 0, 0) });
          }
        } else {
            console.warn('handleSavePdf: Skipping annotation for invalid page number:', annotation);
        }
      });

      console.log('handleSavePdf: Calling pdfDoc.save()...');
      const pdfBytes = await pdfDoc.save(); 
      console.log(`handleSavePdf: pdfDoc.save() completed. Bytes length: ${pdfBytes.byteLength}`);

      console.log('handleSavePdf: Sending bytes to main process via IPC...');
      window.ipc.send('save-pdf-dialog', pdfBytes);

    } catch (err) {
      console.error('Error saving PDF:', err);
      setError(`Error saving PDF: ${err.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };
  // --- End Save Logic ---

  return (
    <div className="container">
      <h1>PDF Editor</h1>

      <PdfToolbar
        key={filePath || 'no-file'}
        filePath={filePath}
        pdfDoc={pdfDoc}
        editMode={editMode}
        handleFileChange={handleFileChange}
        onSetEditMode={handleSetEditMode}
        annotations={annotations}
        onSavePdf={handleSavePdf}
      />

      {isLoading && <div className="loading-indicator">Loading PDF...</div>}
      {error && <div className="error-message">{error}</div>}
      
      {/* Guidance text - Keep for context */}
      {editMode === 'select-text-pos' && (
          <div style={{ marginTop: '10px', fontStyle: 'italic', color: '#555' }}>
              Click on the PDF page to position the text.
          </div>
      )}

      {/* --- Restore Viewer --- */}
      {pdfDoc && pageDimensions.length > 0 && !isLoading && (
        <PdfViewer
          pdfDoc={pdfDoc}
          pageDimensions={pageDimensions}
          annotations={annotations}
          editMode={editMode}
          selectedFontSize={selectedFontSize}
          devicePixelRatio={devicePixelRatio}
          onAnnotationAdd={handleAnnotationAdd}
          onSetEditMode={handleSetEditMode}
          onError={handleViewerError}
        />
      )}
      {/* --- End Restore Viewer --- */}

    </div>
  )
}

export default App
