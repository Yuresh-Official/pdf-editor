import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PDFDocument, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import './App.css'; // අපි css ෆයිල් එක හදමු

// PDF.js worker එක configure කරන්න
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

function App() {
  const [pdfBytes, setPdfBytes] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [modifiedText, setModifiedText] = useState([]); // format: { text: 'N.G. NALIN', page: 0, x: 100, y: 100 }
  const [addedImages, setAddedImages] = useState([]); // format: { src: 'blob...', x: 50, y: 50, w: 100, h: 100 }
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // PDF එකක් Load කරන්න
  const onFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const fileReader = new FileReader();
    fileReader.onload = async function() {
      const bytes = new Uint8Array(this.result);
      setPdfBytes(bytes);
      setCurrentPage(1);
      // Reset modifications
      setModifiedText([]);
      setAddedImages([]);
      renderPage(bytes, 1);
    };
    fileReader.readAsArrayBuffer(file);
  };

  // PDF Page එක Render කරන්න (PDF.js)
  const renderPage = useCallback(async (bytes, pageNumber) => {
    const loadingTask = pdfjsLib.getDocument({data: bytes});
    const pdfDoc = await loadingTask.promise;
    if (pageNumber > pdfDoc.numPages) return;
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({scale: 1.5});

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };
    await page.render(renderContext).promise;

    // TODO: PDF Text එක PDF.js හරහා තේරුම්ගෙන (text content stream) 
    // ඒවා තියෙන තැන් වල Textbox (div) දාන්න ඕනේ. මේක ටිකක් advanced.
    // HTML-based rendering path එක පාවිච්චි කිරීම වඩා සුදුසුයි.
  }, []);

  useEffect(() => {
    if (pdfBytes) {
      renderPage(pdfBytes, currentPage);
    }
  }, [pdfBytes, currentPage, renderPage]);

  // Handle Drag Over
  const onDragOver = (e) => {
    e.preventDefault();
  };

  // Handle Drop Image
  const onDrop = (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const rect = containerRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          setAddedImages([...addedImages, {
            src: event.target.result,
            x: x,
            y: y,
            w: 100, // Default width
            h: 100  // Default height
          }]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  // Handle Text Click & Edit
  const handleTextClick = (e, modificationIndex) => {
    // මේක PDF Text content stream එක PDF.js හරහා render කරන HTML elements
    // වලින් text extract කරගන්නා HTML-based approach එකකින් කරන්න ඕනේ.
    // Canvas එකට කෙලින්ම click කරලා text edit කිරීම අපහසුයි.
    // මම මේ සඳහා text-layer support එක add කරලා තියෙනවා css එකේ.
    alert("Text layer is currently for reference. Advanced text modification (in-place) requires deeper PDF object analysis.");
  };

  // PDF එක save කරන්න
  const downloadPdf = async () => {
    if (!pdfBytes) return;
    const { PDFDocument, rgb } = PDFLib; // PDF-Lib load කරන්න
    const pdfDocInstance = await PDFDocument.load(pdfBytes);
    const pages = pdfDocInstance.getPages();
    const firstPage = pages[currentPage - 1]; // currentPage zero-indexed
    const { width, height } = firstPage.getSize();

    // Text modifications
    modifiedText.forEach(textMod => {
      // PDF-Lib does not support direct font-based replacement easily
      // A typical method is to erase old text and write new text.
      // This is still limited in functionality. 
      // Need precise positioning and font matching.
      
      // Let's assume for now, it acts like adding text.
      firstPage.drawText(textMod.text, {
          x: textMod.x,
          y: height - textMod.y, // Correct y-coordinate
          size: 16,
          color: rgb(0,0,0)
      });
    });

    // Image modifications
    for (const imageMod of addedImages) {
        // Embed the image bytes
        const imageBytes = await fetch(imageMod.src).then((res) => res.arrayBuffer());
        const imageEmbed = await pdfDocInstance.embedPng(imageBytes); // Or embedJpg
        
        const scale = 1.0; // Assume scale is 1.0
        firstPage.drawImage(imageEmbed, {
            x: imageMod.x,
            y: height - imageMod.y - imageMod.h, // Correct y-coordinate
            width: imageMod.w,
            height: imageMod.h,
        });
    }

    const modifiedPdfBytes = await pdfDocInstance.save();
    const blob = new Blob([modifiedPdfBytes], { type: "application/pdf" });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = "edited_project_react.pdf";
    link.click();
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Advanced React PDF Editor</h1>
      </header>

      <div className="controls">
        <input type="file" onChange={onFileChange} accept=".pdf" />
        <button onClick={downloadPdf} disabled={!pdfBytes}>Download Modified PDF</button>
      </div>

      <div className="editor-container" ref={containerRef} onDragOver={onDragOver} onDrop={onDrop}>
        <div id="pdf-wrapper" style={{position: 'relative'}}>
            <canvas ref={canvasRef}></canvas>
            
            {/* Added Images for display */}
            {addedImages.map((img, index) => (
                <img key={index} src={img.src} alt="added" style={{
                    position: 'absolute',
                    left: `${img.x}px`,
                    top: `${img.y}px`,
                    width: `${img.w}px`,
                    height: `${img.h}px`,
                    pointerEvents: 'none' // Allow canvas clicks
                }} />
            ))}

            {/* TODO: Add HTML text-layer on top of canvas using PDF.js text layer path */}
        </div>
        {!pdfBytes && <p>කරුණාකර PDF එකක් අප්ලෝඩ් කරන්න...</p>}
      </div>
    </div>
  );
}

export default App;

