import React from 'react';

// Receive props from App
function PdfToolbar({ 
    filePath, 
    pdfDoc, 
    editMode, 
    annotations, // Need annotations to enable/disable Save
    handleFileChange, 
    onSetEditMode, // Renamed for clarity
    handleAddTextClick, // Still needed to trigger overlay/mode change
    onSavePdf // Add prop for saving
}) {
  
  // Handler to simplify setting edit mode
  const setMode = (mode) => () => onSetEditMode(mode);

  // ---> Add Log <--- 
  console.log(`[PdfToolbar] Rendering. Annotations length: ${annotations.length}, Save button disabled: ${annotations.length === 0}`);
  // ---> End Log <--- 

  return (
    <div 
      className="controls-container"
      onClick={(e) => {
        console.log('[PdfToolbar Container] Click detected. Target:', e.target);
      }}
    >
      {/* File Input Group */}
      <div className="control-group">
        <label htmlFor="file-upload" className="file-input-label">
          Choose PDF
        </label>
        <input id="file-upload" type="file" accept=".pdf" onChange={handleFileChange} />
        {filePath && <span className="file-name">{filePath}</span>}
      </div>

      {/* Show edit controls only if a PDF is loaded */}
      {pdfDoc && (
        <>
          {/* Edit Mode Controls Group */}
          <div className="control-group">
            <button 
              onClick={setMode('view')} 
              disabled={editMode === 'view'}
              className={editMode === 'view' ? 'active-mode' : ''}
            >
              View Mode
            </button>
            <button 
              onClick={setMode('select-text-pos')} // Change mode directly
              disabled={editMode === 'select-text-pos' || editMode === 'editing-inline'} 
              className={editMode === 'select-text-pos' || editMode === 'editing-inline' ? 'active-mode' : ''}
            >
              Add Text
            </button>
            <button 
              onClick={setMode('add-cross')} 
              disabled={editMode === 'add-cross'}
              className={editMode === 'add-cross' ? 'active-mode' : ''}
            >
              Add Cross Mark
            </button>
          </div>

          {/* Save Button - Removed wrapping div */}
          <button 
            onClick={() => { 
              console.log("[PdfToolbar] Save button clicked!");
              onSavePdf();
            }}
            disabled={annotations.length === 0}
            title={annotations.length === 0 ? "Add annotations first" : "Save changes to a new PDF"}
            style={{ 
              marginLeft: '10px', 
              position: 'relative',
              zIndex: 100
            }}
          >
            Save PDF
          </button>
        </>
      )}
    </div>
  );
}

export default PdfToolbar; 