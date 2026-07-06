pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let originalBytes = null;
let pdfScale = 1.5; 
let originalPageWidth = 0;
let originalPageHeight = 0;

let textEdits = {}; 
let imageEdits = []; 
let customTextBoxes = []; 
let eraseDrawings = []; 
let isEraseModeActive = false; 
let isDrawing = false;
let currentStroke = null;

const pdfUpload = document.getElementById('pdf-upload');
const pdfFilenameInput = document.getElementById('pdf-filename');
const imageUpload = document.getElementById('image-upload');
const addImageBtn = document.getElementById('add-image-btn');
const addTextboxBtn = document.getElementById('add-textbox-btn');
const eraseToggleBtn = document.getElementById('erase-toggle-btn');
const downloadBtn = document.getElementById('download-btn');
const placeholder = document.getElementById('placeholder');
const scrollBox = document.getElementById('scroll-box');
const viewerContainer = document.getElementById('viewer-container');
const canvas = document.getElementById('pdf-canvas');
const ctx = canvas.getContext('2d');
const textLayerDiv = document.getElementById('text-layer');
const pageWrapper = document.getElementById('page-wrapper');
const dropZone = document.getElementById('drop-zone');

pdfUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    pdfFilenameInput.value = nameWithoutExt + "_edited";

    const reader = new FileReader();
    reader.onload = async function() {
        originalBytes = new Uint8Array(this.result);
        textEdits = {}; imageEdits = []; eraseDrawings = []; customTextBoxes = [];
        isEraseModeActive = false;
        eraseToggleBtn.innerText = "🧹 Eraser: OFF";
        textLayerDiv.style.zIndex = '20';
        
        document.querySelectorAll('.dropped-image, .editable-input, .custom-text-box').forEach(el => el.remove());
        
        await renderPdfPage();
        downloadBtn.disabled = false;
        addImageBtn.disabled = false;
        addTextboxBtn.disabled = false;
        eraseToggleBtn.disabled = false;
        placeholder.classList.add('hidden');
        scrollBox.classList.remove('hidden');
    };
    reader.readAsArrayBuffer(file);
});

eraseToggleBtn.addEventListener('click', () => {
    isEraseModeActive = !isEraseModeActive;
    if (isEraseModeActive) {
        eraseToggleBtn.innerText = "🧹 Eraser: ON";
        textLayerDiv.style.zIndex = '5';
    } else {
        eraseToggleBtn.innerText = "🧹 Eraser: OFF";
        textLayerDiv.style.zIndex = '20';
    }
});

async function renderPdfPage() {
    const loadingTask = pdfjsLib.getDocument({data: originalBytes});
    const pdfDoc = await loadingTask.promise;
    const page = await pdfDoc.getPage(1); 

    const viewport = page.getViewport({ scale: pdfScale });
    originalPageWidth = page.getViewport({ scale: 1.0 }).width;
    originalPageHeight = page.getViewport({ scale: 1.0 }).height;

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    viewerContainer.style.width = viewport.width + 'px';
    viewerContainer.style.height = viewport.height + 'px';

    const renderContext = { canvasContext: ctx, viewport: viewport };
    await page.render(renderContext).promise;

    textLayerDiv.innerHTML = '';
    setupCanvasEraser(); 

    const textContent = await page.getTextContent();
    let idx = 0;
    textContent.items.forEach((item) => {
        if (!item.str.trim()) return;
        idx++;

        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const span = document.createElement('span');
        span.id = 'span_' + idx;
        span.innerText = item.str;
        
        const computedTop = tx[5] - (item.height * pdfScale);
        
        span.style.left = `${tx[4]}px`;
        span.style.top = `${computedTop}px`; 
        span.style.fontSize = `${item.height * pdfScale}px`;
        span.style.width = `${item.width * pdfScale}px`;
        span.style.height = `${item.height * pdfScale}px`;
        
        let isFontBold = item.fontName.toLowerCase().includes('bold') || item.fontName.toLowerCase().includes('black') || item.fontName.toLowerCase().includes('w700');

        span.addEventListener('click', (e) => {
            if (isEraseModeActive) return;
            e.stopPropagation();
            
            const bgPixel = ctx.getImageData(tx[4] + 1, computedTop + 1, 1, 1).data;
            const bgRGB = `rgb(${bgPixel[0]}, ${bgPixel[1]}, ${bgPixel[2]})`;

            let textR = 0, textG = 0, textB = 0;
            let maxDist = -1;
            const startX = Math.floor(tx[4] + (item.width * pdfScale) * 0.2);
            const endX = Math.floor(tx[4] + (item.width * pdfScale) * 0.8);
            const startY = Math.floor(computedTop + (item.height * pdfScale) * 0.2);
            const endY = Math.floor(computedTop + (item.height * pdfScale) * 0.8);

            for (let x = startX; x < endX; x += Math.max(1, Math.floor((endX - startX) / 5))) {
                for (let y = startY; y < endY; y += Math.max(1, Math.floor((endY - startY) / 5))) {
                    const p = ctx.getImageData(x, y, 1, 1).data;
                    const dist = Math.abs(p[0] - bgPixel[0]) + Math.abs(p[1] - bgPixel[1]) + Math.abs(p[2] - bgPixel[2]);
                    if (dist > maxDist) {
                        maxDist = dist;
                        textR = p[0]; textG = p[1]; textB = p[2];
                    }
                }
            }

            if (maxDist < 40) {
                const brightness = (bgPixel[0] * 299 + bgPixel[1] * 587 + bgPixel[2] * 114) / 1000;
                textR = textG = textB = brightness > 128 ? 0 : 255;
            }

            const textRGB = `rgb(${textR}, ${textG}, ${textB})`;
            const currentActiveText = textEdits[span.id] ? textEdits[span.id].rawInput : item.str;

            createSeamlessInputBox(span, item, tx[4], computedTop, bgRGB, bgPixel, textRGB, textR, textG, textB, isFontBold, currentActiveText);
        });

        textLayerDiv.appendChild(span);
    });
}

function createSeamlessInputBox(span, item, leftPos, topPos, bgRGB, bgPixel, textRGB, textR, textG, textB, isFontBold, currentActiveText) {
    span.style.visibility = 'hidden';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'editable-input';
    input.value = currentActiveText;
    
    input.style.left = `${leftPos - 4}px`;
    input.style.top = `${topPos - 4}px`;
    input.style.fontSize = `${item.height * pdfScale}px`;
    input.style.width = `${Math.max(item.width * pdfScale + 60, 160)}px`;
    input.style.height = `${item.height * pdfScale * 1.25}px`;
    input.style.backgroundColor = bgRGB; 
    input.style.color = textRGB;
    
    const verifyTextWeight = (val) => {
        if (isFontBold || (val.startsWith('*') && val.endsWith('*') && val.length > 1)) {
            input.style.fontWeight = '700';
        } else {
            input.style.fontWeight = 'normal';
        }
    };
    verifyTextWeight(currentActiveText);
    input.addEventListener('input', () => verifyTextWeight(input.value));

    pageWrapper.appendChild(input);
    input.focus();
    input.select();

    const saveEdits = () => {
        let rawVal = input.value;
        let cleanVal = rawVal;
        let finalBold = isFontBold;

        if (rawVal.startsWith('*') && rawVal.endsWith('*') && rawVal.length > 1) {
            cleanVal = rawVal.substring(1, rawVal.length - 1);
            finalBold = true;
        }
        
        textEdits[span.id] = {
            x: leftPos / pdfScale,
            y: originalPageHeight - (topPos / pdfScale) - item.height, 
            newText: cleanVal,
            rawInput: rawVal,
            fontSize: item.height,
            originalWidth: (item.width * pdfScale) / pdfScale,
            originalHeight: item.height,
            isBold: finalBold,
            bgColor: { r: bgPixel[0]/255, g: bgPixel[1]/255, b: bgPixel[2]/255 },
            textColor: { r: textR/255, g: textG/255, b: textB/255 }
        };
        
        ctx.fillStyle = bgRGB;
        ctx.fillRect(leftPos - 2, topPos - 2, (item.width * pdfScale) + 4, item.height * pdfScale + 4);
        
        ctx.fillStyle = textRGB;
        ctx.font = `${finalBold ? '700 ' : ''}${item.height * pdfScale}px 'Helvetica Neue', Helvetica, Arial, sans-serif`;
        ctx.fillText(cleanVal, leftPos, topPos + (item.height * pdfScale * 0.85));
        
        input.remove();
    };

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEdits(); });
    input.addEventListener('blur', saveEdits);
}

function setupCanvasEraser() {
    const getCanvasCoords = (e) => {
        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX; clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX; clientY = e.clientY;
        }
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    };

    const startEraseStroke = (e) => {
        if (!isEraseModeActive) return;
        isDrawing = true;
        const pos = getCanvasCoords(e);
        
        const pixel = ctx.getImageData(pos.x, pos.y, 1, 1).data;
        const strokeRGB = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;

        currentStroke = {
            color: { r: pixel[0]/255, g: pixel[1]/255, b: pixel[2]/255 },
            points: [{ x: pos.x / pdfScale, y: originalPageHeight - (pos.y / pdfScale) }]
        };

        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineWidth = 16; 
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = strokeRGB;
    };

    const continueEraseStroke = (e) => {
        if (!isDrawing || !isEraseModeActive) return;
        if (e.cancelable) e.preventDefault(); 
        
        const pos = getCanvasCoords(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        currentStroke.points.push({ x: pos.x / pdfScale, y: originalPageHeight - (pos.y / pdfScale) });
    };

    const finishEraseStroke = () => {
        if (isDrawing && currentStroke) { eraseDrawings.push(currentStroke); }
        isDrawing = false; currentStroke = null;
    };

    canvas.addEventListener('mousedown', startEraseStroke);
    canvas.addEventListener('mousemove', continueEraseStroke);
    window.addEventListener('mouseup', finishEraseStroke);

    canvas.addEventListener('touchstart', startEraseStroke, { passive: false });
    canvas.addEventListener('touchmove', continueEraseStroke, { passive: false });
    window.addEventListener('touchend', finishEraseStroke);
}

dropZone.addEventListener('click', () => imageUpload.click());
addImageBtn.addEventListener('click', () => imageUpload.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) processImage(e.dataTransfer.files[0]);
});
imageUpload.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processImage(e.target.files[0]);
});

function processImage(file) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (event) => renderImageOnCanvas(event.target.result);
    reader.readAsDataURL(file);
}

function renderImageOnCanvas(base64Src) {
    const imgId = 'img_' + Date.now();
    const wrapper = document.createElement('div');
    wrapper.className = 'dropped-image';
    wrapper.id = imgId;
    wrapper.style.left = '80px';
    wrapper.style.top = '80px';
    wrapper.style.width = '130px'; 
    wrapper.style.height = '130px';

    const img = document.createElement('img');
    img.src = base64Src;
    img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'contain';
    img.style.pointerEvents = 'none';
    wrapper.appendChild(img);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'action-btn-container';

    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'action-btn btn-delete'; deleteBtn.innerText = '×';
    deleteBtn.onclick = (e) => { e.stopPropagation(); wrapper.remove(); imageEdits = imageEdits.filter(i => i.id !== imgId); };

    const confirmBtn = document.createElement('div');
    confirmBtn.className = 'action-btn btn-confirm'; confirmBtn.innerText = '✓';
    
    btnContainer.appendChild(confirmBtn); btnContainer.appendChild(deleteBtn);
    wrapper.appendChild(btnContainer);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    wrapper.appendChild(resizeHandle);
    
    pageWrapper.appendChild(wrapper);

    let imageTrackingObj = {
        id: imgId,
        x: 80 / pdfScale,
        y: originalPageHeight - ((80 + 130) / pdfScale),
        w: 130 / pdfScale,
        h: 130 / pdfScale,
        src: base64Src
    };
    imageEdits.push(imageTrackingObj);

    confirmBtn.onclick = (e) => {
        e.stopPropagation();
        wrapper.classList.add('locked');
        btnContainer.style.display = 'none'; resizeHandle.style.display = 'none';
    };

    wrapper.onclick = (e) => {
        if (wrapper.classList.contains('locked')) {
            e.stopPropagation();
            wrapper.classList.remove('locked');
            btnContainer.style.display = 'flex'; resizeHandle.style.display = 'block';
        }
    };

    setupDraggableInteractions(wrapper, resizeHandle, (updatedLeft, updatedTop, updatedWidth, updatedHeight) => {
        imageTrackingObj.x = updatedLeft / pdfScale;
        imageTrackingObj.y = originalPageHeight - ((updatedTop + updatedHeight) / pdfScale);
        imageTrackingObj.w = updatedWidth / pdfScale;
        imageTrackingObj.h = updatedHeight / pdfScale;
    });
}

addTextboxBtn.addEventListener('click', () => {
    const boxId = 'box_' + Date.now();
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-text-box';
    wrapper.id = boxId;
    wrapper.style.left = '100px';
    wrapper.style.top = '150px';
    wrapper.style.width = '220px';
    wrapper.style.height = '90px';

    const textarea = document.createElement('textarea');
    textarea.placeholder = "මෙහි ලියන්න (Bold කිරීමට වචනය දෙපැත්තට * යොදන්න)...";
    textarea.style.width = '100%';
    textarea.style.height = '100%';
    textarea.style.background = 'transparent';
    textarea.style.border = 'none';
    textarea.style.outline = 'none';
    textarea.style.resize = 'none';
    textarea.style.color = '#000000';
    textarea.style.padding = '4px';
    textarea.style.fontFamily = "'Helvetica Neue', Helvetica, Arial, sans-serif";
    
    let currentFontSize = 14; 
    textarea.style.fontSize = currentFontSize + 'px';
    wrapper.appendChild(textarea);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'action-btn-container';

    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'action-btn btn-delete'; deleteBtn.innerText = '×';
    deleteBtn.onclick = (e) => { e.stopPropagation(); wrapper.remove(); customTextBoxes = customTextBoxes.filter(b => b.id !== boxId); };

    const confirmBtn = document.createElement('div');
    confirmBtn.className = 'action-btn btn-confirm'; confirmBtn.innerText = '✓';
    
    btnContainer.appendChild(confirmBtn); btnContainer.appendChild(deleteBtn);
    wrapper.appendChild(btnContainer);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    wrapper.appendChild(resizeHandle);

    pageWrapper.appendChild(wrapper);

    let detectedTextR = 0, detectedTextG = 0, detectedTextB = 0;
    const updateTextColorBasedOnBackground = () => {
        const sampleX = wrapper.offsetLeft + 10;
        const sampleY = wrapper.offsetTop + 10;
        const bgPixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
        const brightness = (bgPixel[0] * 299 + bgPixel[1] * 587 + bgPixel[2] * 114) / 1000;
        
        if (brightness > 128) {
            detectedTextR = 0; detectedTextG = 0; detectedTextB = 0;
        } else {
            detectedTextR = 255; detectedTextG = 255; detectedTextB = 255;
        }
        textarea.style.color = `rgb(${detectedTextR}, ${detectedTextG}, ${detectedTextB})`;
    };
    updateTextColorBasedOnBackground();

    let textBoxObj = {
        id: boxId,
        x: 100 / pdfScale,
        y: originalPageHeight - ((150 + 90) / pdfScale),
        w: 220 / pdfScale,
        h: 90 / pdfScale,
        fontSize: currentFontSize / pdfScale, 
        text: "",
        textColor: { r: 0, g: 0, b: 0 } 
    };
    customTextBoxes.push(textBoxObj);

    textarea.addEventListener('input', () => { textBoxObj.text = textarea.value; });

    confirmBtn.onclick = (e) => {
        e.stopPropagation();
        if(!textarea.value.trim()){ wrapper.remove(); return; }
        
        updateTextColorBasedOnBackground(); 
        textBoxObj.textColor = { r: detectedTextR / 255, g: detectedTextG / 255, b: detectedTextB / 255 };

        wrapper.classList.add('locked');
        textarea.style.pointerEvents = 'none'; 
        btnContainer.style.display = 'none'; resizeHandle.style.display = 'none';
    };

    wrapper.onclick = (e) => {
        if (wrapper.classList.contains('locked')) {
            e.stopPropagation();
            wrapper.classList.remove('locked');
            textarea.style.pointerEvents = 'auto';
            btnContainer.style.display = 'flex'; resizeHandle.style.display = 'block';
        }
    };

    setupDraggableInteractions(wrapper, resizeHandle, (updatedLeft, updatedTop, updatedWidth, updatedHeight) => {
        textBoxObj.x = updatedLeft / pdfScale;
        textBoxObj.y = originalPageHeight - ((updatedTop + updatedHeight) / pdfScale);
        textBoxObj.w = updatedWidth / pdfScale;
        textBoxObj.h = updatedHeight / pdfScale;
        
        currentFontSize = Math.max(8, Math.floor(updatedHeight * 0.16)); 
        textarea.style.fontSize = currentFontSize + 'px';
        textBoxObj.fontSize = currentFontSize / pdfScale;
        updateTextColorBasedOnBackground();
    });
});

function setupDraggableInteractions(element, handle, onUpdate) {
    const startDrag = (e) => {
        if (element.classList.contains('locked') || e.target === handle || e.target.classList.contains('action-btn') || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        let startX = clientX, startY = clientY;
        
        const moveDrag = (ev) => {
            const currentX = ev.touches ? ev.touches[0].clientX : ev.clientX;
            const currentY = ev.touches ? ev.touches[0].clientY : ev.clientY;
            let dx = currentX - startX; let dy = currentY - startY;
            let nextLeft = element.offsetLeft + dx; let nextTop = element.offsetTop + dy;
            element.style.left = nextLeft + 'px'; element.style.top = nextTop + 'px';
            startX = currentX; startY = currentY;
            onUpdate(nextLeft, nextTop, element.offsetWidth, element.offsetHeight);
        };
        const stopDrag = () => { 
            document.removeEventListener('mousemove', moveDrag); document.removeEventListener('mouseup', stopDrag);
            document.removeEventListener('touchmove', moveDrag); document.removeEventListener('touchend', stopDrag);
        };
        document.addEventListener('mousemove', moveDrag); document.addEventListener('mouseup', stopDrag);
        document.addEventListener('touchmove', moveDrag, { passive: false }); document.addEventListener('touchend', stopDrag);
    };
    element.addEventListener('mousedown', startDrag);
    element.addEventListener('touchstart', startDrag, { passive: false });

    const startResize = (e) => {
        e.stopPropagation(); e.preventDefault();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        let startX = clientX, startY = clientY;
        let startW = element.offsetWidth, startH = element.offsetHeight;

        const moveResize = (ev) => {
            const currentX = ev.touches ? ev.touches[0].clientX : ev.clientX;
            const currentY = ev.touches ? ev.touches[0].clientY : ev.clientY;
            let currentWidth = startW + (currentX - startX);
            let currentHeight = startH + (currentY - startY);
            if (currentWidth > 40 && currentHeight > 30) {
                element.style.width = currentWidth + 'px';
                element.style.height = currentHeight + 'px';
                onUpdate(element.offsetLeft, element.offsetTop, currentWidth, currentHeight);
            }
        };
        const stopResize = () => { 
            document.removeEventListener('mousemove', moveResize); document.removeEventListener('mouseup', stopResize);
            document.removeEventListener('touchmove', moveResize); document.removeEventListener('touchend', stopResize);
        };
        document.addEventListener('mousemove', moveResize); document.addEventListener('mouseup', stopResize);
        document.addEventListener('touchmove', moveResize, { passive: false }); document.addEventListener('touchend', stopResize);
    };
    handle.addEventListener('mousedown', startResize);
    handle.addEventListener('touchstart', startResize, { passive: false });
}

function base64ToArrayBuffer(base64Url) {
    const base64Str = base64Url.split(',')[1];
    const binaryStr = window.atob(base64Str);
    const uint8Array = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) { uint8Array[i] = binaryStr.charCodeAt(i); }
    return uint8Array.buffer;
}

/* -------------------------------------------------------------
   SAFE DOWNLOADING LOGIC (CORRECTED)
   ------------------------------------------------------------- */
downloadBtn.addEventListener('click', async () => {
    if (!originalBytes) return;
    try {
        const { PDFDocument, rgb, StandardFonts } = PDFLib;
        const pdfDocInstance = await PDFDocument.load(originalBytes);
        const firstPage = pdfDocInstance.getPages()[0];
        
        const cvFont = await pdfDocInstance.embedFont(StandardFonts.Helvetica);
        const cvFontBold = await pdfDocInstance.embedFont(StandardFonts.HelveticaBold);

        // 1. Process Eraser Strokes
        eraseDrawings.forEach(stroke => {
            for (let i = 0; i < stroke.points.length - 1; i++) {
                firstPage.drawLine({
                    start: { x: stroke.points[i].x, y: stroke.points[i].y },
                    end: { x: stroke.points[i+1].x, y: stroke.points[i+1].y },
                    thickness: 14,
                    color: rgb(stroke.color.r, stroke.color.g, stroke.color.b),
                });
            }
        });

        // 2. Original Inline Text Tracing
        Object.values(textEdits).forEach(edit => {
            firstPage.drawRectangle({
                x: edit.x - 1, y: edit.y - 1,
                width: edit.originalWidth * 1.15, height: edit.originalHeight * 1.25,
                color: rgb(edit.bgColor.r, edit.bgColor.g, edit.bgColor.b),
            });
            
            if(edit.newText.trim().length > 0) {
                firstPage.drawText(edit.newText, {
                    x: edit.x, y: edit.y + (edit.fontSize * 0.05),
                    size: edit.fontSize,
                    font: edit.isBold ? cvFontBold : cvFont,
                    color: rgb(edit.textColor.r, edit.textColor.g, edit.textColor.b),
                });
            }
        });

        // 3. Render Custom Multi-line Text Boxes
        customTextBoxes.forEach(box => {
            if (!box.text.trim()) return;
            
            const lines = box.text.split('\n');
            let currentYLinePosition = box.y + box.h - box.fontSize - 4; 

            lines.forEach(lineText => {
                if(currentYLinePosition >= box.y) {
                    let cleanLine = lineText;
                    let drawFont = cvFont;

                    if (lineText.startsWith('*') && lineText.endsWith('*') && lineText.length > 1) {
                        cleanLine = lineText.substring(1, lineText.length - 1);
                        drawFont = cvFontBold;
                    }

                    firstPage.drawText(cleanLine, {
                        x: box.x + 4,
                        y: currentYLinePosition,
                        size: box.fontSize,
                        font: drawFont,
                        color: rgb(box.textColor.r, box.textColor.g, box.textColor.b),
                    });
                    currentYLinePosition -= (box.fontSize * 1.35); 
                }
            });
        });

        // 4. Render Images
        for (const imgEdit of imageEdits) {
            const buffer = base64ToArrayBuffer(imgEdit.src);
            const embeddedImage = imgEdit.src.includes('image/png') ? 
                await pdfDocInstance.embedPng(buffer) : await pdfDocInstance.embedJpg(buffer);

            firstPage.drawImage(embeddedImage, {
                x: imgEdit.x, y: imgEdit.y,
                width: imgEdit.w, height: imgEdit.h
            });
        }

        const finalPdfBytes = await pdfDocInstance.save();
        
        // Safe Name Parsing
        let filename = pdfFilenameInput.value.trim();
        if (!filename) filename = "studio_fixed_output";
        if (!filename.toLowerCase().endsWith(".pdf")) {
            filename += ".pdf";
        }

        // Triggering download using a clean workflow
        const blob = new Blob([finalPdfBytes], { type: "application/pdf" });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        link.href = downloadUrl;
        link.download = filename;
        
        document.body.appendChild(link);
        link.click();
        
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 100);

    } catch (err) {
        console.error("Detailed Error Logs:", err); // බ්‍රව්සර් එකේ inspect මඟින් නියම වැරැද්ද බලාගත හැක.
        alert("PDF එක සකස් කිරීමේදී හෝ ඩවුන්ලෝඩ් කිරීමේදී ගැටලුවක් මතු විය.");
    }
});

