// import React, { useState, useEffect, useRef } from 'react'
import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import PropTypes from 'prop-types'

// Constants might be moved to a shared file later
const FONT_FAMILY = 'Helvetica'
const FONT_WEIGHT = 'normal'

// Receive props from App
function PdfViewer({
  pdfDoc,
  pageDimensions,
  annotations,
  editMode,
  selectedFontSize, // Receive from App
  devicePixelRatio,
  onAnnotationAdd, // Callback to update annotations in App
  onSetEditMode, // Callback to change mode in App
  onError // Callback to report errors to App
}) {
  // Log received props
  console.log(
    '[PdfViewer Props] pdfDoc:',
    pdfDoc ? 'Exists' : 'Null',
    'pageDimensions:',
    pageDimensions,
    'annotations:',
    annotations
  )

  // --- State and Refs specific to the viewer ---
  const [inlineEditor, setInlineEditor] = useState({
    visible: false,
    x: 0,
    y: 0,
    displayX: 0,
    displayY: 0,
    page: 0,
    value: '',
    offsetTop: 0,
    offsetLeft: 0
  })
  const pdfContainerRef = useRef(null)
  const renderTaskRefs = useRef({})
  const inlineTextRef = useRef(null)
  const redrawDebounceTimers = useRef({})
  // --- End State and Refs ---

  // --- Drawing Logic ---
  // (renderPageWithAnnotations and drawAnnotationsForPage moved here)
  const drawAnnotationsForPage = (context, pageNum) => {
    const pageAnnotations = annotations.filter((a) => a.page === pageNum)
    if (pageAnnotations.length === 0) return

    console.log(
      `Drawing ${pageAnnotations.length} annotations for page ${pageNum} onto visible canvas`
    )
    const defaultBaseline = context.textBaseline
    const defaultFont = context.font
    pageAnnotations.forEach((annotation) => {
      context.fillStyle = 'black'
      context.strokeStyle = 'black'
      context.lineWidth = 2
      context.font = `${FONT_WEIGHT} ${selectedFontSize}px ${FONT_FAMILY}`
      if (annotation.type === 'text') {
        context.textBaseline = 'top'
        context.fillText(annotation.text, annotation.x, annotation.y)
      } else if (annotation.type === 'cross') {
        context.textBaseline = defaultBaseline
        const crossSize = 10
        context.beginPath()
        context.moveTo(annotation.x - crossSize, annotation.y - crossSize)
        context.lineTo(annotation.x + crossSize, annotation.y + crossSize)
        context.moveTo(annotation.x + crossSize, annotation.y - crossSize)
        context.lineTo(annotation.x - crossSize, annotation.y + crossSize)
        context.stroke()
      }
    })
    context.textBaseline = defaultBaseline
    context.font = defaultFont
  }

  // --- Effects ---
  // Effect for initial draw / redraw - Use useLayoutEffect
  useLayoutEffect(() => {
    console.log('[Viewer Initial Draw LayoutEffect] Triggered.')
    if (!pdfDoc || !pageDimensions || pageDimensions.length === 0) {
      console.log('[Viewer Initial Draw LayoutEffect] Guarded: pdfDoc or pageDimensions not ready.')
      return
    }
    console.log('[Viewer Initial Draw LayoutEffect] Running main logic...')

    const container = pdfContainerRef.current
    if (!container) {
      console.warn('[Viewer Initial Draw LayoutEffect] Container ref not found!')
      return
    }

    // Query the DOM for canvases rendered by React
    const canvasNodes = container.querySelectorAll('canvas[data-page-number]')
    console.log(`[Viewer Initial Draw LayoutEffect] Found ${canvasNodes.length} canvas nodes.`)

    // Create a map for quick lookup
    const canvasMap = new Map()
    canvasNodes.forEach((node) => {
      const pageNum = parseInt(node.dataset.pageNumber, 10)
      if (!isNaN(pageNum)) {
        canvasMap.set(pageNum, node)
      }
    })

    // Now iterate through dimensions and draw using found nodes
    pageDimensions.forEach((pd) => {
      const pageNum = pd.pageNum
      const canvas = canvasMap.get(pageNum) // Get VISIBLE canvas node from map

      if (canvas) {
        const context = canvas.getContext('2d')
        if (context) {
          // Set the VISIBLE canvas buffer size here, ONCE. drawPageAsync won't do this anymore.
          canvas.width = Math.round(pd.width * devicePixelRatio)
          canvas.height = Math.round(pd.height * devicePixelRatio)
          // The style width/height are set declaratively in JSX
          context.resetTransform() // Reset just in case
          context.clearRect(0, 0, canvas.width, canvas.height) // Initial clear

          // Pass VISIBLE canvas and context to drawPageAsync
          drawPageAsync(pageNum, canvas, context, pd.width, pd.height)
        } else {
          console.warn(`[Viewer Initial Draw LayoutEffect] No context for page ${pageNum}`)
        }
      } else {
        // This indicates a mismatch between pageDimensions and rendered canvases
        console.warn(
          `[Viewer Initial Draw LayoutEffect] Canvas node NOT found in DOM for page ${pageNum}!`
        )
      }
    })

    // Cleanup function
    return () => {
      console.log('[Viewer Initial Draw LayoutEffect] Cleanup: Cancelling tasks')
      const tasks = Object.values(renderTaskRefs.current)
      tasks.forEach((task) => task?.cancel())
      renderTaskRefs.current = {}
    }
  }, [pdfDoc, pageDimensions, devicePixelRatio])

  // Async function to handle actual page getting and rendering using an OffscreenCanvas
  const drawPageAsync = async (
    pageNum,
    visibleCanvas, // Now receiving the visible canvas element
    visibleContext, // We might still need this for drawing annotations later
    displayWidth,
    displayHeight
  ) => {
    console.log(`[drawPageAsync ${pageNum}] Starting render (using OffscreenCanvas).`)

    // --- Cancel existing task FIRST (still important for managing pdf.js internal state/resources) ---
    const existingTask = renderTaskRefs.current[pageNum]
    if (existingTask) {
      console.log(`[drawPageAsync ${pageNum}] Found existing task. Attempting to cancel.`)
      try {
        existingTask.cancel()
        console.log(`[drawPageAsync ${pageNum}] Cancellation requested for existing task.`)
        await new Promise((resolve) => setTimeout(resolve, 0)) // Keep minimal delay
        console.log(`[drawPageAsync ${pageNum}] Continued after minimal delay post-cancellation.`)
      } catch (e) {
        console.warn(`[drawPageAsync ${pageNum}] Error trying to cancel existing task:`, e)
      }
    }
    // --- End Cancellation ---

    // --- Create Offscreen Canvas ---
    const offscreenCanvas = new OffscreenCanvas(
      Math.round(displayWidth * devicePixelRatio),
      Math.round(displayHeight * devicePixelRatio)
    )
    const offscreenContext = offscreenCanvas.getContext('2d')
    if (!offscreenContext) {
      console.error(`[drawPageAsync ${pageNum}] Failed to get OffscreenCanvas context.`)
      onError(`Failed to create rendering context for page ${pageNum}.`)
      return
    }
    // Apply scaling to the offscreen context - pdf.js needs this
    offscreenContext.scale(devicePixelRatio, devicePixelRatio)
    // --- End Offscreen Canvas Setup ---

    let newTask
    try {
      console.log(`[drawPageAsync ${pageNum}] Getting page object.`)
      const page = await pdfDoc.getPage(pageNum)
      const viewport = page.getViewport({ scale: 1.5 }) // Use the same scale

      // Use the OFFSCREEN context for rendering
      const renderContext = { canvasContext: offscreenContext, viewport: viewport }

      console.log(`[drawPageAsync ${pageNum}] Calling page.render() onto OffscreenCanvas.`)
      newTask = page.render(renderContext)
      delete renderTaskRefs.current[pageNum]
      renderTaskRefs.current[pageNum] = newTask

      console.log(`[drawPageAsync ${pageNum}] Waiting for offscreen render promise.`)
      await newTask.promise

      // --- Copy to Visible Canvas ---
      if (renderTaskRefs.current[pageNum] === newTask) {
        console.log(
          `[drawPageAsync ${pageNum}] Offscreen render completed. Copying to visible canvas.`
        )
        // Clear the visible canvas before drawing
        visibleContext.clearRect(0, 0, visibleCanvas.width, visibleCanvas.height)
        // Draw the offscreen canvas onto the visible one
        visibleContext.drawImage(offscreenCanvas, 0, 0)
        // Draw annotations ON TOP of the rendered PDF on the VISIBLE canvas
        console.log(`[drawPageAsync ${pageNum}] Drawing annotations onto visible canvas.`)
        drawAnnotationsForPage(visibleContext, pageNum)

        delete renderTaskRefs.current[pageNum]
      } else {
        console.log(
          `[drawPageAsync ${pageNum}] Offscreen render completed but task ref was overwritten/deleted. Assuming cancelled.`
        )
      }
      // --- End Copy ---
    } catch (error) {
      // Check if the ref (at the time of catching) corresponds to the task that threw the error
      const isCurrentTaskError = renderTaskRefs.current[pageNum] === newTask
      if (error?.name === 'RenderingCancelledException') {
        // If this task (newTask) was the one in the ref when it was cancelled, clear the ref.
        console.log(`[drawPageAsync ${pageNum}] Caught RenderingCancelledException.`)
        if (isCurrentTaskError) {
          console.log(`[drawPageAsync ${pageNum}] Clearing ref for cancelled task.`)
          delete renderTaskRefs.current[pageNum]
        } else {
          console.log(
            `[drawPageAsync ${pageNum}] Caught cancellation, but ref points to a different/newer task or was already cleared.`
          )
        }
      } else {
        // Actual error
        console.error(`[drawPageAsync ${pageNum}] Error during offscreen render:`, error)
        onError(`Error rendering page ${pageNum}: ${error.message || error}`)
        // If this task (newTask) was the one in the ref when it errored, clear the ref.
        if (isCurrentTaskError) {
          console.log(`[drawPageAsync ${pageNum}] Clearing ref due to error.`)
          delete renderTaskRefs.current[pageNum]
        } else {
          console.log(
            `[drawPageAsync ${pageNum}] Caught error, but ref points to a different/newer task or was already cleared.`
          )
        }
      }
    }
  }

  // Effect for targeted annotation redraw with DEBOUNCING
  useEffect(() => {
    if (!pdfDoc || !annotations) return
    console.log('[Viewer Annotation Effect] Annotation state changed.')
    const dirtyPages = new Set(annotations.map((a) => a.page))

    const container = pdfContainerRef.current
    if (!container) return

    dirtyPages.forEach((pageNum) => {
      // Clear existing debounce timer for this page
      if (redrawDebounceTimers.current[pageNum]) {
        clearTimeout(redrawDebounceTimers.current[pageNum])
        console.log(`[Annotation Debounce ${pageNum}] Cleared existing timer.`)
      }

      // Set a new debounce timer
      console.log(`[Annotation Debounce ${pageNum}] Setting new timer (100ms).`)
      redrawDebounceTimers.current[pageNum] = setTimeout(() => {
        console.log(`[Annotation Debounce ${pageNum}] Timer expired. Triggering redraw.`)
        // Query DOM for the specific VISIBLE canvas *inside* the timeout callback
        const canvas = container.querySelector(`canvas[data-page-number="${pageNum}"]`)
        if (canvas) {
          const context = canvas.getContext('2d')
          const pageInfo = pageDimensions.find((pd) => pd.pageNum === pageNum)
          if (context && pageInfo) {
            // ---> Pass VISIBLE canvas and context to drawPageAsync <---
            drawPageAsync(pageNum, canvas, context, pageInfo.width, pageInfo.height)
          } else {
            console.warn(
              `[Annotation Debounce ${pageNum}] Missing context or pageInfo inside timer.`
            )
          }
        } else {
          console.warn(`[Annotation Debounce ${pageNum}] No canvas node found in DOM inside timer.`)
        }
        delete redrawDebounceTimers.current[pageNum]
      }, 100) // Debounce delay (e.g., 100ms)
    })

    // Cleanup function for the effect
    return () => {
      console.log('[Viewer Annotation Effect Cleanup] Clearing all debounce timers.')
      Object.values(redrawDebounceTimers.current).forEach(clearTimeout)
      redrawDebounceTimers.current = {}
    }
  }, [annotations]) // Dependencies: pdfDoc, pageDimensions, devicePixelRatio, annotations?
  // Consider if pdfDoc, pageDimensions, devicePixelRatio also need to be deps here?
  // For now, keeping just annotations seems correct for a *redraw* effect.

  // Effect for cursor update
  useEffect(() => {
    console.log(`[Viewer Cursor Effect] Updating cursor for mode: ${editMode}`)
    let cursorStyle = 'default'
    if (editMode === 'select-text-pos') {
      cursorStyle = 'text' // Use text cursor for placing text
    } else if (editMode === 'add-cross') {
      cursorStyle = 'crosshair'
    } // Keep default for 'view' and 'editing-inline'

    pageDimensions.forEach((pd) => {
      // Query DOM for canvas inside the effect
      const canvas = pdfContainerRef.current?.querySelector(
        `canvas[data-page-number="${pd.pageNum}"]`
      )
      if (canvas) {
        canvas.style.cursor = cursorStyle
      }
    })
  }, [editMode, pageDimensions])
  // --- End Effects ---

  // --- Event Handlers ---
  const handleCanvasClick = (event) => {
    const canvas = event.target
    if (!canvas || !(canvas instanceof HTMLCanvasElement) || !canvas.dataset.pageNumber) {
      if (editMode === 'editing-inline') {
        handleInlineEditorBlur()
      }
      return
    }
    const pageNum = parseInt(canvas.dataset.pageNumber, 10)
    const rect = canvas.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const clickY = event.clientY - rect.top
    // Scale click coords based on the ACTUAL canvas buffer vs display size
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const x = clickX * scaleX
    const y = clickY * scaleY

    if (editMode === 'select-text-pos') {
      let offsetTop = canvas.offsetTop
      let offsetLeft = canvas.offsetLeft
      setInlineEditor({
        visible: true,
        x: x,
        y: y,
        displayX: clickX,
        displayY: clickY,
        page: pageNum,
        value: '',
        offsetTop: offsetTop,
        offsetLeft: offsetLeft
      })
      onSetEditMode('editing-inline') // Call prop handler
      setTimeout(() => inlineTextRef.current?.focus(), 0)
    } else if (editMode === 'add-cross') {
      const newAnnotation = { type: 'cross', x, y, page: pageNum }
      onAnnotationAdd(newAnnotation) // Call prop handler
      // Optionally set mode back to view via onSetEditMode('view');
    } else if (editMode === 'editing-inline') {
      handleInlineEditorBlur()
    }
  }

  const handleInlineEditorBlur = () => {
    if (!inlineEditor.visible) return // Prevent running if already hidden
    console.log('[handleInlineEditorBlur] Finalizing text.')
    if (inlineEditor.value.trim()) {
      const newAnnotation = {
        type: 'text',
        x: inlineEditor.x,
        y: inlineEditor.y,
        page: inlineEditor.page,
        text: inlineEditor.value.trim()
      }
      onAnnotationAdd(newAnnotation) // Call prop handler
    }
    setInlineEditor({
      visible: false,
      x: 0,
      y: 0,
      page: 0,
      value: '',
      displayX: 0,
      displayY: 0,
      offsetTop: 0,
      offsetLeft: 0
    })
    onSetEditMode('view') // Call prop handler
  }

  const handleInlineEditorKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleInlineEditorBlur()
    }
    if (event.key === 'Escape') {
      console.log('[handleInlineEditorKeyDown] Escape pressed, cancelling.')
      setInlineEditor({
        visible: false,
        x: 0,
        y: 0,
        page: 0,
        value: '',
        displayX: 0,
        displayY: 0,
        offsetTop: 0,
        offsetLeft: 0
      })
      onSetEditMode('view') // Call prop handler
    }
  }

  const handleInlineEditorChange = (event) => {
    setInlineEditor((prev) => ({ ...prev, value: event.target.value }))
  }
  // --- End Event Handlers ---

  return (
    <div
      ref={pdfContainerRef}
      className="pdf-viewer-scroll-container"
      style={{ position: 'relative' /* ... other styles ... */ }}
    >
      {/* Declarative Canvas Rendering */}
      {pageDimensions.map(({ pageNum, width, height }) => (
        <canvas
          key={pageNum}
          data-page-number={pageNum}
          onClick={handleCanvasClick}
          style={{
            display: 'block',
            margin: '0 auto 10px auto',
            width: `${width}px`, // Set CSS width/height based on dimensions
            height: `${height}px`,
            border: '1px solid #ccc',
            boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)'
            // Cursor set by effect
          }}
        />
      ))}

      {/* Inline Text Editor */}
      {inlineEditor.visible && (
        <textarea
          ref={inlineTextRef}
          className="inline-text-editor"
          value={inlineEditor.value}
          onChange={handleInlineEditorChange}
          onBlur={handleInlineEditorBlur}
          onKeyDown={handleInlineEditorKeyDown}
          style={{
            position: 'absolute',
            top: `${inlineEditor.offsetTop + inlineEditor.displayY}px`,
            left: `${inlineEditor.offsetLeft + inlineEditor.displayX}px`,
            zIndex: 10,
            border: 'none',
            outline: '1px dashed blue',
            padding: '0',
            fontSize: `${selectedFontSize}px`,
            fontFamily: FONT_FAMILY,
            fontWeight: FONT_WEIGHT,
            lineHeight: '1.2',
            background: 'transparent',
            minWidth: '50px',
            minHeight: '20px',
            resize: 'none'
          }}
        />
      )}
    </div>
  )
}

// Define prop types
PdfViewer.propTypes = {
  pdfDoc: PropTypes.object, // pdfjs Document object (or null)
  pageDimensions: PropTypes.arrayOf(
    PropTypes.shape({
      pageNum: PropTypes.number.isRequired,
      width: PropTypes.number.isRequired,
      height: PropTypes.number.isRequired
    })
  ).isRequired,
  annotations: PropTypes.array.isRequired,
  editMode: PropTypes.string.isRequired,
  selectedFontSize: PropTypes.number.isRequired,
  devicePixelRatio: PropTypes.number.isRequired,
  onAnnotationAdd: PropTypes.func.isRequired,
  onSetEditMode: PropTypes.func.isRequired,
  onError: PropTypes.func.isRequired
}

export default PdfViewer
