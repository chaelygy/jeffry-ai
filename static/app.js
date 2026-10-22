/**
 * =====================================================================
 *  JEFFRY // NEURAL BIOMETRICS CORE HUD - Frontend Engine
 *  Cyberpunk Sci-Fi Telemetry & Real-Time Biometric Analysis
 * =====================================================================
 */

const CLOUD_BACKEND_URL = 'https://centers-provided-iowa-revised.trycloudflare.com';

const isFileProtocol = window.location.protocol === 'file:';
const isLocal = Boolean(
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '' ||
    isFileProtocol
);

let defaultApi = 'http://localhost:5000';
if (!isLocal) {
    defaultApi = CLOUD_BACKEND_URL;
} else if (!isFileProtocol && window.location.origin && window.location.origin !== 'null') {
    defaultApi = window.location.origin;
} else {
    defaultApi = 'http://localhost:5000';
}

const customApi = localStorage.getItem('faceid_backend_url');
let API_BASE = (customApi ? customApi.replace(/\/$/, '') : defaultApi);
const WEBCAM_INTERVAL_MS = 1400;
const JPEG_QUALITY = 0.86;

function configureServerUrl() {
    const current = localStorage.getItem('faceid_backend_url') || API_BASE;
    const input = prompt(
        "JEFFRY // NEURAL CORE CONFIG\n" +
        "Input Backend Gateway Address:\n" +
        "• Local Dev: http://localhost:5000\n" +
        "• Tunnel Link: https://xxxx.trycloudflare.com\n\n" +
        "Current Link:",
        current
    );
    if (input !== null) {
        const clean = input.trim().replace(/\/$/, '');
        if (clean) {
            localStorage.setItem('faceid_backend_url', clean);
        } else {
            localStorage.removeItem('faceid_backend_url');
        }
        window.location.reload();
    }
}

// System State
let currentMode = 'webcam';
let webcamStream = null;
let webcamActive = false;
let captureInterval = null;
let isProcessing = false;
let registeredPersons = [];

const elements = {
    navStatus: document.getElementById('navStatus'),
    statPersons: document.getElementById('statPersons'),
    btnWebcam: document.getElementById('btnWebcam'),
    btnUpload: document.getElementById('btnUpload'),
    panelTitle: document.getElementById('panelTitle'),
    webcamControls: document.getElementById('webcamControls'),
    webcamWrapper: document.getElementById('webcamWrapper'),
    uploadWrapper: document.getElementById('uploadWrapper'),
    webcamVideo: document.getElementById('webcamVideo'),
    overlayCanvas: document.getElementById('overlayCanvas'),
    scanLine: document.getElementById('scanLine'),
    videoPlaceholder: document.getElementById('videoPlaceholder'),
    btnStartCam: document.getElementById('btnStartCam'),
    btnStopCam: document.getElementById('btnStopCam'),
    uploadZone: document.getElementById('uploadZone'),
    fileInput: document.getElementById('fileInput'),
    uploadedPreview: document.getElementById('uploadedPreview'),
    uploadedImage: document.getElementById('uploadedImage'),
    uploadOverlayCanvas: document.getElementById('uploadOverlayCanvas'),
    faceCount: document.getElementById('faceCount'),
    perfTime: document.getElementById('perfTime'),
    processingIndicator: document.getElementById('processingIndicator'),
    resultsList: document.getElementById('resultsList'),
    modelEngine: document.getElementById('modelEngine'),
    detectorEngine: document.getElementById('detectorEngine'),
    thresholdVal: document.getElementById('thresholdVal'),
    btnRefreshDb: document.getElementById('btnRefreshDb'),
    personsList: document.getElementById('personsList'),
    searchPersons: document.getElementById('searchPersons'),
    clockDigits: document.getElementById('clockDigits')
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    checkServerHealth();
    loadPersons();
    setupEventListeners();
    initClock();
    setInterval(checkServerHealth, 10000);
});

function initClock() {
    function update() {
        const now = new Date();
        const str = now.toTimeString().split(' ')[0];
        if (elements.clockDigits) {
            elements.clockDigits.textContent = str;
        }
    }
    update();
    setInterval(update, 1000);
}

function setupEventListeners() {
    if (elements.searchPersons) {
        elements.searchPersons.addEventListener('input', (e) => filterPersons(e.target.value));
    }

    if (elements.uploadZone) {
        elements.uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            elements.uploadZone.classList.add('drag-over');
        });
        elements.uploadZone.addEventListener('dragleave', () => {
            elements.uploadZone.classList.remove('drag-over');
        });
        elements.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            elements.uploadZone.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                processUploadedFile(e.dataTransfer.files[0]);
            }
        });
    }

    window.addEventListener('resize', () => {
        if (webcamActive) syncCanvasSize();
    });
}

async function checkServerHealth() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`${API_BASE}/api/health`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            updateServerStatus(true, `ONLINE [${data.persons_count || data.registered_persons_count || '24'} ID]`);
            if (elements.statPersons && (data.persons_count || data.registered_persons_count)) {
                elements.statPersons.textContent = data.persons_count || data.registered_persons_count;
            }
            if (data.model && elements.modelEngine) elements.modelEngine.textContent = data.model;
            if (data.detector && elements.detectorEngine) elements.detectorEngine.textContent = data.detector;
            if (data.threshold && elements.thresholdVal) elements.thresholdVal.textContent = data.threshold;
        } else {
            updateServerStatus(false, 'GATEWAY ERR');
        }
    } catch (err) {
        updateServerStatus(false, 'DISCONNECTED');
    }
}

function updateServerStatus(online, text) {
    if (!elements.navStatus) return;
    const dot = elements.navStatus.querySelector('.pulse-indicator');
    const label = elements.navStatus.querySelector('.status-name');
    if (dot) {
        dot.className = `pulse-indicator ${online ? 'online' : 'offline'}`;
    }
    if (label) label.textContent = text;
}

async function loadPersons() {
    try {
        const res = await fetch(`${API_BASE}/api/persons`);
        if (res.ok) {
            const data = await res.json();
            registeredPersons = data.persons || [];
            renderPersonsList(registeredPersons);
            if (elements.statPersons) elements.statPersons.textContent = registeredPersons.length;
        }
    } catch (err) {
        console.warn('Could not load persons from backend:', err);
    }
}

function renderPersonsList(persons) {
    if (!elements.personsList) return;
    if (persons.length === 0) {
        elements.personsList.innerHTML = `<div class="cyber-loader">NO RECORDS IN BUFFER</div>`;
        return;
    }
    elements.personsList.innerHTML = persons.map(p => `
        <div class="cyber-person-node" title="${escapeHtml(p.name)}">
            <span class="node-icon"></span>
            <span class="node-name">${escapeHtml(p.name)}</span>
        </div>
    `).join('');
}

function filterPersons(query) {
    const q = query.toLowerCase().trim();
    const filtered = registeredPersons.filter(p => p.name.toLowerCase().includes(q));
    renderPersonsList(filtered);
}

function switchMode(mode) {
    if (currentMode === mode) return;
    currentMode = mode;

    if (mode === 'webcam') {
        elements.btnWebcam.classList.add('active');
        elements.btnUpload.classList.remove('active');
        elements.webcamWrapper.classList.remove('hidden');
        elements.uploadWrapper.classList.add('hidden');
        elements.webcamControls.classList.remove('hidden');
        elements.panelTitle.textContent = 'OPTICAL SENSOR ARRAY';
    } else {
        elements.btnUpload.classList.add('active');
        elements.btnWebcam.classList.remove('active');
        elements.webcamWrapper.classList.add('hidden');
        elements.uploadWrapper.classList.remove('hidden');
        elements.webcamControls.classList.add('hidden');
        elements.panelTitle.textContent = 'BUFFER INGEST VIEWER';
        if (webcamActive) stopWebcam();
    }
    clearResults();
}

async function startWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: false
        });

        webcamStream = stream;
        elements.webcamVideo.srcObject = stream;
        elements.webcamVideo.onloadedmetadata = () => {
            elements.webcamVideo.play();
            webcamActive = true;
            syncCanvasSize();
            elements.videoPlaceholder.classList.add('hidden');
            elements.scanLine.classList.remove('hidden');
            elements.btnStartCam.classList.add('hidden');
            elements.btnStopCam.classList.remove('hidden');
            startCaptureLoop();
        };
    } catch (err) {
        alert('OPTICAL SENSOR ACCESS FAILED: ' + err.message);
    }
}

function stopWebcam() {
    webcamActive = false;
    if (captureInterval) clearInterval(captureInterval);
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
    if (elements.webcamVideo) elements.webcamVideo.srcObject = null;
    if (elements.videoPlaceholder) elements.videoPlaceholder.classList.remove('hidden');
    if (elements.scanLine) elements.scanLine.classList.add('hidden');
    if (elements.btnStartCam) elements.btnStartCam.classList.remove('hidden');
    if (elements.btnStopCam) elements.btnStopCam.classList.add('hidden');

    const ctx = elements.overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, elements.overlayCanvas.width, elements.overlayCanvas.height);
    clearResults();
}

function syncCanvasSize() {
    const video = elements.webcamVideo;
    if (video.videoWidth && video.videoHeight) {
        elements.overlayCanvas.width = video.videoWidth;
        elements.overlayCanvas.height = video.videoHeight;
    }
}

function startCaptureLoop() {
    if (captureInterval) clearInterval(captureInterval);
    captureInterval = setInterval(captureAndSendFrame, WEBCAM_INTERVAL_MS);
    captureAndSendFrame();
}

async function captureAndSendFrame() {
    if (!webcamActive || isProcessing) return;
    const video = elements.webcamVideo;
    if (video.readyState < 2) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(video, 0, 0);

    const imageData = tempCanvas.toDataURL('image/jpeg', JPEG_QUALITY);
    await sendForRecognition(imageData, 'webcam');
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (file) processUploadedFile(file);
}

function processUploadedFile(file) {
    if (!file.type.startsWith('image/')) {
        alert('INVALID BUFFER FORMAT: Expected JPG, PNG, or WEBP');
        return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
        const imageData = e.target.result;
        elements.uploadedImage.src = imageData;
        elements.uploadZone.classList.add('hidden');
        elements.uploadedPreview.classList.remove('hidden');

        elements.uploadedImage.onload = async () => {
            const img = elements.uploadedImage;
            elements.uploadOverlayCanvas.width = img.naturalWidth;
            elements.uploadOverlayCanvas.height = img.naturalHeight;
            await sendForRecognition(imageData, 'upload');
        };
    };
    reader.readAsDataURL(file);
}

function removeUpload() {
    elements.uploadedImage.src = '';
    elements.uploadedPreview.classList.add('hidden');
    elements.uploadZone.classList.remove('hidden');
    elements.fileInput.value = '';
    const ctx = elements.uploadOverlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, elements.uploadOverlayCanvas.width, elements.uploadOverlayCanvas.height);
    clearResults();
}

async function sendForRecognition(imageData, source) {
    if (isProcessing) return;
    isProcessing = true;
    if (elements.processingIndicator) elements.processingIndicator.classList.remove('hidden');

    try {
        const res = await fetch(`${API_BASE}/api/recognize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: imageData })
        });

        const data = await res.json();
        if (data.error) {
            console.error('Inference error:', data.error);
        } else {
            displayResults(data.faces, data.processing_time_ms);
            if (source === 'webcam') {
                drawBoundingBoxes(elements.overlayCanvas, data.faces, true);
            } else {
                drawBoundingBoxes(elements.uploadOverlayCanvas, data.faces, false);
            }
        }
    } catch (err) {
        console.error('Neural gateway connection error:', err);
    } finally {
        isProcessing = false;
        if (elements.processingIndicator) elements.processingIndicator.classList.add('hidden');
    }
}

// Bounding box: Cyberpunk HUD Targeting Reticles
function drawBoundingBoxes(canvas, faces, isMirrored) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    faces.forEach((face, index) => {
        let { x, y, w: bw, h: bh } = face.bbox;
        if (isMirrored) {
            x = w - x - bw;
        }

        const isRecognized = face.name !== 'Unknown';
        const color = isRecognized ? '#00ff88' : '#ffaa00';
        const glowColor = isRecognized ? 'rgba(0, 255, 136, 0.5)' : 'rgba(255, 170, 0, 0.45)';

        // Laser glow
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 16;

        // Sharp cyber bracket corners
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        const cornerLen = Math.min(bw, bh) * 0.25;

        // Top-left
        ctx.beginPath();
        ctx.moveTo(x, y + cornerLen);
        ctx.lineTo(x, y);
        ctx.lineTo(x + cornerLen, y);
        ctx.stroke();

        // Top-right
        ctx.beginPath();
        ctx.moveTo(x + bw - cornerLen, y);
        ctx.lineTo(x + bw, y);
        ctx.lineTo(x + bw, y + cornerLen);
        ctx.stroke();

        // Bottom-left
        ctx.beginPath();
        ctx.moveTo(x, y + bh - cornerLen);
        ctx.lineTo(x, y + bh);
        ctx.lineTo(x + cornerLen, y + bh);
        ctx.stroke();

        // Bottom-right
        ctx.beginPath();
        ctx.moveTo(x + bw - cornerLen, y + bh);
        ctx.lineTo(x + bw, y + bh);
        ctx.lineTo(x + bw, y + bh - cornerLen);
        ctx.stroke();

        // Crosshairs on center of face
        ctx.shadowBlur = 0;
        const cx = x + bw / 2;
        const cy = y + bh / 2;
        const chSize = 8;
        ctx.strokeStyle = 'rgba(0, 243, 255, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - chSize, cy);
        ctx.lineTo(cx + chSize, cy);
        ctx.moveTo(cx, cy - chSize);
        ctx.lineTo(cx, cy + chSize);
        ctx.stroke();

        // Fine wireframe frame
        ctx.strokeStyle = isRecognized ? 'rgba(0, 255, 136, 0.2)' : 'rgba(255, 170, 0, 0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, bw, bh);

        // Cyber Tag Header
        const targetTag = `[TARGET_${String(index + 1).padStart(2, '0')}] ${face.name.toUpperCase()}`;
        const subTag = isRecognized ? `CONF: ${face.confidence}% // D: ${face.distance}` : `STATUS: UNVERIFIED`;

        ctx.font = `700 ${Math.max(12, bw * 0.055)}px "Orbitron", monospace`;
        const textMetrics = ctx.measureText(targetTag);
        const tagW = Math.max(textMetrics.width + 16, 140);
        const tagH = Math.max(24, bw * 0.075);
        const tagY = y - tagH - 6;

        // Angled cyber tag background
        ctx.fillStyle = isRecognized ? 'rgba(0, 255, 136, 0.95)' : 'rgba(255, 170, 0, 0.95)';
        ctx.beginPath();
        ctx.moveTo(x, tagY);
        ctx.lineTo(x + tagW - 8, tagY);
        ctx.lineTo(x + tagW, tagY + 8);
        ctx.lineTo(x + tagW, tagY + tagH);
        ctx.lineTo(x, tagY + tagH);
        ctx.closePath();
        ctx.fill();

        // Text inside tag
        ctx.fillStyle = '#050811';
        ctx.textBaseline = 'middle';
        ctx.fillText(targetTag, x + 8, tagY + tagH / 2);

        // Sub-coordinate tag below bounding box
        ctx.font = `500 11px "JetBrains Mono", monospace`;
        ctx.fillStyle = isRecognized ? '#00ff88' : '#ffaa00';
        ctx.fillText(`LOC: [${Math.round(x)}, ${Math.round(y)}] ${subTag}`, x, y + bh + 14);
    });
}

function displayResults(faces, processingTime) {
    if (elements.faceCount) elements.faceCount.textContent = `${faces.length} TARGETS`;
    if (elements.perfTime) elements.perfTime.textContent = `${Math.round(processingTime)} ms`;

    if (!elements.resultsList) return;
    if (faces.length === 0) {
        elements.resultsList.innerHTML = `
            <div class="tech-idle-state">
                <div class="target-cross-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
                        <circle cx="12" cy="12" r="9"/>
                        <line x1="12" y1="3" x2="12" y2="7"/>
                        <line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                </div>
                <h3>NO BIOMETRIC ENTITIES DETECTED</h3>
                <p>Sensor array is scanning field of view. Ensure subjects are properly illuminated.</p>
            </div>
        `;
        return;
    }

    const sorted = [...faces].sort((a, b) => {
        if (a.name === 'Unknown' && b.name !== 'Unknown') return 1;
        if (a.name !== 'Unknown' && b.name === 'Unknown') return -1;
        return b.confidence - a.confidence;
    });

    elements.resultsList.innerHTML = sorted.map((face, i) => {
        const isRecognized = face.name !== 'Unknown';
        const cardClass = isRecognized ? 'recognized' : 'unknown';
        const initials = isRecognized ? getInitials(face.name) : '??';
        const statusText = isRecognized ? 'AUTHORIZED' : 'UNVERIFIED';

        return `
            <div class="cyber-card ${cardClass}">
                <div class="card-top-row">
                    <div class="card-avatar-group">
                        <div class="card-avatar">${initials}</div>
                        <div>
                            <div class="card-identity-name">${escapeHtml(face.name)}</div>
                            <span style="font-size: 0.65rem; color: #64748b;">ID_NODE_${String(i + 1).padStart(2, '0')}</span>
                        </div>
                    </div>
                    <span class="card-auth-tag">${statusText}</span>
                </div>
                <div class="card-meta-metrics">
                    <span class="metric-conf">CONF: ${face.confidence}%</span>
                    <span class="metric-dist">COS_DIST: ${face.distance}</span>
                </div>
                ${isRecognized ? `
                    <div class="card-progress-track">
                        <div class="card-progress-fill" style="width: ${face.confidence}%"></div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function clearResults() {
    if (elements.faceCount) elements.faceCount.textContent = '0 TARGETS';
    if (elements.perfTime) elements.perfTime.textContent = '0 ms';
    if (elements.resultsList) {
        elements.resultsList.innerHTML = `
            <div class="tech-idle-state" id="emptyState">
                <div class="target-cross-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
                        <circle cx="12" cy="12" r="9"/>
                        <line x1="12" y1="3" x2="12" y2="7"/>
                        <line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                </div>
                <h3>STANDBY FOR BIOMETRIC SCAN</h3>
                <p>Engage optical feed or buffer image to execute neural cosine verification.</p>
            </div>
        `;
    }
}

function getInitials(name) {
    return name.split(' ')
        .filter(w => w.length > 0)
        .map(w => w[0].toUpperCase())
        .slice(0, 2)
        .join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
