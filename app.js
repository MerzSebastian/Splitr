// Global variables
let cv = null;
let originalImage = null;
let isOpenCvReady = false;

// Helper: format a value with an optional unit
function fmt(value, decimals = 2) {
    const u = params.unit ? ' ' + params.unit : '';
    return `${value.toFixed(decimals)}${u}`;
}

// DOM elements
const elements = {
    imageInput: null,
    fileName: null,
    resultCanvas: null,
    binaryCanvas: null,
    resultsDiv: null,
    saveBtn: null,
    loading: null
};

// Parameters
const params = {
    blur: 5,
    threshold: 180,
    morphSize: 7,
    morphClose: 3,
    morphOpen: 2,
    minArea: 5000,
    useAdjusted: true,
    noOriginal: false,
    value: '',
    unit: ''
};

// Defaults for all sliders
const DEFAULTS = {
    blur: 5,
    threshold: 180,
    morphSize: 7,
    morphClose: 3,
    morphOpen: 2,
    minArea: 5000
};

function resetFormToDefaults() {
    // Force every slider back to its default — runs after browser session-restore
    Object.entries(DEFAULTS).forEach(([id, val]) => {
        const slider = document.getElementById(id);
        const span   = document.getElementById(id + 'Value');
        if (slider) { slider.value = val; }
        if (span)   { span.textContent = val; }
        params[id] = val;
    });
    document.getElementById('weight').value = '';
    document.getElementById('unit').value   = '';
    params.weight = '';
    params.unit   = '';
    // Reset checkboxes to their defaults
    const useAdjustedEl = document.getElementById('useAdjusted');
    const noOriginalEl  = document.getElementById('noOriginal');
    if (useAdjustedEl) { useAdjustedEl.checked = params.useAdjusted; }
    if (noOriginalEl)  { noOriginalEl.checked  = params.noOriginal; }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initializeElements();
    resetFormToDefaults();
    setupEventListeners();
    showLoading(true);
});

// window.load fires AFTER browser restores form values from session/bfcache
// so we reset again here to guarantee sliders match params
window.addEventListener('load', resetFormToDefaults);

function initializeElements() {
    elements.imageInput = document.getElementById('imageInput');
    elements.fileName = document.getElementById('fileName');
    elements.resultCanvas = document.getElementById('resultCanvas');
    elements.binaryCanvas = document.getElementById('binaryCanvas');
    elements.resultsDiv = document.getElementById('results');
    elements.saveBtn = document.getElementById('saveBtn');
    elements.loading = document.getElementById('loading');
}

function setupEventListeners() {
    // Image upload
    elements.imageInput.addEventListener('change', handleImageUpload);
    
    // Sliders
    const sliders = ['blur', 'threshold', 'morphSize', 'morphClose', 'morphOpen', 'minArea'];
    sliders.forEach(id => {
        const slider = document.getElementById(id);
        const valueSpan = document.getElementById(id + 'Value');

        // Force slider position from params defaults (overrides browser cache)
        let initVal = params[id];
        slider.value = initVal;
        valueSpan.textContent = initVal;

        slider.addEventListener('input', (e) => {
            let value = parseInt(e.target.value);
            // Ensure odd values for blur and morphSize
            if ((id === 'blur' || id === 'morphSize') && value % 2 === 0) {
                value += 1;
                slider.value = value;
            }
            valueSpan.textContent = value;
            params[id] = value;
            if (originalImage) processImage();
        });
    });
    
    // Checkboxes
    document.getElementById('useAdjusted').addEventListener('change', (e) => {
        params.useAdjusted = e.target.checked;
        if (originalImage) processImage();
    });
    
    document.getElementById('noOriginal').addEventListener('change', (e) => {
        params.noOriginal = e.target.checked;
        if (originalImage) processImage();
    });
    
    // Value inputs (weight, pieces, etc.)
    document.getElementById('weight').addEventListener('input', (e) => {
        params.weight = e.target.value;
        if (originalImage) processImage();
    });
    
    document.getElementById('unit').addEventListener('input', (e) => {
        params.unit = e.target.value;
        if (originalImage) processImage();
    });
    
    // Save button
    elements.saveBtn.addEventListener('click', saveResult);
}

function onOpenCvReady() {
    cv = window.cv;
    isOpenCvReady = true;
    showLoading(false);
    console.log('OpenCV.js is ready!');
}

function showLoading(show) {
    elements.loading.style.display = show ? 'flex' : 'none';
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    elements.fileName.textContent = file.name;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            originalImage = cv.imread(img);
            processImage();
            elements.saveBtn.disabled = false;
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function processImage() {
    if (!isOpenCvReady || !originalImage) return;

    // Always read live from DOM so values set before image load are respected
    params.weight = document.getElementById('weight').value;
    params.unit   = document.getElementById('unit').value;

    try {
        // Convert to grayscale
        let gray = new cv.Mat();
        cv.cvtColor(originalImage, gray, cv.COLOR_RGBA2GRAY);
        
        // Apply Gaussian blur
        let blurred = new cv.Mat();
        let ksize = new cv.Size(params.blur, params.blur);
        cv.GaussianBlur(gray, blurred, ksize, 0);
        
        // Threshold
        let binary = new cv.Mat();
        cv.threshold(blurred, binary, params.threshold, 255, cv.THRESH_BINARY);
        
        // Morphological operations
        if (params.morphSize > 0) {
            let kernel = cv.getStructuringElement(
                cv.MORPH_RECT,
                new cv.Size(params.morphSize, params.morphSize)
            );
            
            if (params.morphClose > 0) {
                cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel, 
                               new cv.Point(-1, -1), params.morphClose);
            }
            
            if (params.morphOpen > 0) {
                cv.morphologyEx(binary, binary, cv.MORPH_OPEN, kernel,
                               new cv.Point(-1, -1), params.morphOpen);
            }
            
            kernel.delete();
        }
        
        // Find contours
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        
        // Filter contours by area
        let filteredContours = [];
        for (let i = 0; i < contours.size(); i++) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);
            if (area >= params.minArea) {
                filteredContours.push({
                    contour: contour,
                    area: area
                });
            }
        }
        
        // Find the largest contour as the "original"
        let originalRect = null;
        let originalArea = 0;
        let originalIndex = -1;
        
        if (!params.noOriginal && filteredContours.length > 1) {
            // Simply pick the largest contour — the "original" is always the
            // biggest detected object.  We store its index so the identity
            // check below can reliably skip it in the fragment list.
            filteredContours.forEach((item, i) => {
                if (item.area > originalArea) {
                    originalArea = item.area;
                    originalRect = item.contour;
                    originalIndex = i;
                }
            });
        }
        
        // Calculate fragments
        let fragments = [];
        let totalFragmentArea = 0;
        
        filteredContours.forEach((item, i) => {
            // Skip original in normal mode
            if (!params.noOriginal && originalRect && i === originalIndex) {
                return;
            }
            
            totalFragmentArea += item.area;
            let pct = originalArea > 0 ? (item.area / originalArea * 100) : 0;
            
            fragments.push({
                index: fragments.length + 1,
                contour: item.contour,
                area: item.area,
                percentage: pct
            });
        });
        
        // Calculate adjusted percentages
        fragments.forEach(frag => {
            frag.adjustedPercentage = totalFragmentArea > 0 
                ? (frag.area / totalFragmentArea * 100) 
                : 0;
        });
        
        // Calculate weights
        let weightValue = parseFloat(params.weight);
        if (!isNaN(weightValue) && weightValue > 0) {
            fragments.forEach(frag => {
                if (params.noOriginal || params.useAdjusted) {
                    frag.weight = totalFragmentArea > 0 
                        ? (frag.area / totalFragmentArea) * weightValue 
                        : 0;
                } else if (originalArea > 0) {
                    frag.weight = (frag.area / originalArea) * weightValue;
                } else {
                    frag.weight = null;
                }
            });
        }
        
        // Draw results
        drawResults(originalRect, originalArea, fragments, totalFragmentArea, weightValue);
        
        // Display binary
        cv.imshow(elements.binaryCanvas, binary);
        
        // Update results text
        updateResultsText(originalArea, fragments, totalFragmentArea, weightValue);
        
        // Cleanup
        gray.delete();
        blurred.delete();
        binary.delete();
        contours.delete();
        hierarchy.delete();
        
    } catch (error) {
        console.error('Error processing image:', error);
        elements.resultsDiv.textContent = 'Error processing image: ' + error.message;
    }
}

function drawLabelWithBackground(mat, text, x, y, fontScale, textColor) {
    const font      = cv.FONT_HERSHEY_SIMPLEX;
    const thickness = 2;
    const padding   = 4;
    const bgColor   = new cv.Scalar(255, 255, 255, 220);

    // Estimate text size without cv.getTextSize (not available in browser build).
    // Hershey Simplex base height ≈ 22 px at fontScale 1; width ≈ 17 px per char.
    const th = Math.round(22 * fontScale);
    const tw = Math.round(text.length * 17 * fontScale);

    // filled background rect
    cv.rectangle(
        mat,
        new cv.Point(x - padding, y - th - padding),
        new cv.Point(x + tw + padding, y + padding),
        bgColor,
        cv.FILLED
    );
    // text on top
    cv.putText(mat, text, new cv.Point(x, y), font, fontScale, textColor, thickness);
}

function drawResults(originalRect, originalArea, fragments, totalFragmentArea, weightValue) {
    let result = originalImage.clone();
    let hasWeight = !isNaN(weightValue) && weightValue > 0;
    
    // Draw original in green (if not in no-original mode)
    if (originalRect && !params.noOriginal) {
        let color = new cv.Scalar(0, 255, 0, 255);   // RGBA green
        let contourVec = new cv.MatVector();
        contourVec.push_back(originalRect);
        cv.drawContours(result, contourVec, 0, color, 3);
        contourVec.delete();
        
        // Add label
        let M = cv.moments(originalRect);
        if (M.m00 !== 0) {
            let cx = Math.floor(M.m10 / M.m00);
            let cy = Math.floor(M.m01 / M.m00);
            
            let label = hasWeight ? fmt(weightValue) : 'ORIGINAL';
            drawLabelWithBackground(result, label, cx - 60, cy, 1, color);
        }
    }
    
    // Draw fragments in red
    let redColor   = new cv.Scalar(255, 0, 0, 255);   // RGBA red
    let whiteColor = new cv.Scalar(255, 255, 255, 255);
    
    fragments.forEach(frag => {
        let contourVec = new cv.MatVector();
        contourVec.push_back(frag.contour);
        cv.drawContours(result, contourVec, 0, redColor, 3);
        contourVec.delete();
        
        // Add label
        let M = cv.moments(frag.contour);
        if (M.m00 !== 0) {
            let cx = Math.floor(M.m10 / M.m00);
            let cy = Math.floor(M.m01 / M.m00);
            
            let label;
            if (hasWeight && frag.weight != null) {
                label = fmt(frag.weight);
            } else {
                let pct = params.useAdjusted ? frag.adjustedPercentage : frag.percentage;
                label = `${pct.toFixed(1)}%`;
            }
            
            let darkColor = new cv.Scalar(30, 30, 30, 255);
            drawLabelWithBackground(result, label, cx - 40, cy, 0.7, darkColor);
        }
    });
    
    cv.imshow(elements.resultCanvas, result);
    result.delete();
}


function updateResultsText(originalArea, fragments, totalFragmentArea, weightValue) {
    let hasWeight = !isNaN(weightValue) && weightValue > 0;
    let text = '========================================\n';
    text += 'ANALYSIS RESULTS\n';
    text += '========================================\n\n';
    
    if (!params.noOriginal) {
        text += `Original Rectangle:\n`;
        text += `  Area: ${originalArea.toFixed(0)} px²\n`;
        if (hasWeight) {
            text += `  Value: ${fmt(weightValue)}\n`;
        }
        text += '\n';
    } else {
        text += 'Mode: No Original Reference\n';
        text += '(All pieces treated equally)\n\n';
        if (hasWeight) {
            text += `Total Value to Distribute: ${fmt(weightValue)}\n\n`;
        }
    }
    
    text += `Fragments Detected: ${fragments.length}\n\n`;
    
    if (fragments.length > 0) {
        text += 'Individual Fragments:\n';
        text += '----------------------------------------\n';
        
        let totalWeight = 0;
        fragments.forEach(frag => {
            text += `  Fragment ${frag.index}:\n`;
            text += `    Area: ${frag.area.toFixed(0)} px²\n`;
            
            if (hasWeight && frag.weight != null) {
                text += `    Value: ${fmt(frag.weight)}\n`;
                totalWeight += frag.weight;
            } else {
                text += `    Percentage: ${frag.percentage.toFixed(2)}%\n`;
                if (params.useAdjusted) {
                    text += `    Adjusted %: ${frag.adjustedPercentage.toFixed(2)}%\n`;
                }
            }
            text += '\n';
        });
        
        text += '----------------------------------------\n';
        
        if (hasWeight) {
            text += `Total Fragment Value: ${fmt(totalWeight)}\n`;
        } else {
            text += `Total Fragment Area: ${totalFragmentArea.toFixed(0)} px²\n`;
            if (!params.noOriginal && originalArea > 0) {
                let totalPct = (totalFragmentArea / originalArea * 100);
                text += `Total Percentage: ${totalPct.toFixed(2)}%\n`;
            }
            if (params.useAdjusted || params.noOriginal) {
                text += '\n✓ Adjusted percentages sum to 100%\n';
            }
        }
    }
    
    elements.resultsDiv.textContent = text;
}

function saveResult() {
    if (!elements.resultCanvas) return;
    
    const link = document.createElement('a');
    link.download = 'fragment_analysis_result.png';
    link.href = elements.resultCanvas.toDataURL();
    link.click();
}

// Service Worker registration for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.log('Service Worker registration failed'));
    });
}
