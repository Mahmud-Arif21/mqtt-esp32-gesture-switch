// --- dropdown + localStorage helper ---
function initDropdown(selectId, storageKey, defaultValues) {
  const sel = document.getElementById(selectId);
  const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
  const list = Array.from(new Set([...defaultValues, ...stored]));
  function render() {
    sel.innerHTML = list.map(v => `<option value="${v}">${v}</option>`).join('');
  }
  render();
  document.querySelector(`button.add-btn[data-key="${storageKey}"]`)
    .addEventListener('click', () => {
      const v = prompt(`New value for ${selectId}:`);
      if (!v) return;
      if (!list.includes(v)) {
        list.push(v);
        localStorage.setItem(storageKey, JSON.stringify(list));
        render();
        sel.value = v;
      }
    });
}

// initialize dropdowns with your defaults
initDropdown('host',    'hosts',   ['192.168.2.254']); // set your default IP
initDropdown('port',    'ports',   ['1883']);
initDropdown('port_ws', 'ports_ws',['9001']);
initDropdown('topic_p', 'topics_p',['webcam/hand_status']);
initDropdown('topic_v', 'topics_v',['webcam/stream']);
// --- end helper ---

// Global variables
let client = null;
let streamInterval = null;
let lastPublishedState = null;
let frameCount = 0;
let lastFrameTime = 0;
let actualFps = 0;
let handGestureAnimationFrame = null;
let cameraInitialized = false;
let modelLoaded = false;

// DOM Elements
const videoElem = document.getElementById('input_video');
const canvasElem = document.getElementById('output_canvas');
const ctx = canvasElem.getContext('2d');
const handStatusElem = document.getElementById('hand-status');
const gestureIconElem = document.getElementById('gesture-icon');
const streamStatusElem = document.getElementById('stream-status');
const resolutionDisplayElem = document.getElementById('resolution-display');
const mqttLogElem = document.getElementById('mqtt-log');
const fpsSlider = document.getElementById('fps');
const fpsValue = document.getElementById('fps-value');
const connectionIndicator = document.getElementById('connection-indicator');
const connectionText = document.getElementById('connection-text');
const cameraStatusElem = document.getElementById('camera-status');
const modelStatusElem = document.getElementById('model-status');

// Initialize canvas size
function initCanvas() {
  // Set canvas to match video dimensions
  const videoWidth = videoElem.videoWidth || 640;
  const videoHeight = videoElem.videoHeight || 480;
  
  canvasElem.width = videoWidth;
  canvasElem.height = videoHeight;
  
  // Update resolution display
  resolutionDisplayElem.textContent = `${videoWidth}×${videoHeight}`;
  
  log('info', `Canvas initialized: ${videoWidth}×${videoHeight}`);
}

// Enhanced logging with categories
function log(category, message) {
  const timestamp = new Date().toLocaleTimeString();
  let cssClass = `log-${category}`;
  
  mqttLogElem.innerHTML += `<div class="log-entry"><span class="log-time">${timestamp}</span> <span class="${cssClass}">${message}</span></div>`;
  mqttLogElem.scrollTop = mqttLogElem.scrollHeight;
}

// Update connection UI
function updateConnectionUI(status) {
  switch(status) {
    case 'connected':
      connectionIndicator.className = 'status-indicator connected';
      connectionText.textContent = 'Connected';
      document.getElementById('connect-btn').disabled = true;
      document.getElementById('disconnect-btn').disabled = false;
      break;
    case 'disconnected':
      connectionIndicator.className = 'status-indicator disconnected';
      connectionText.textContent = 'Disconnected';
      document.getElementById('connect-btn').disabled = false;
      document.getElementById('disconnect-btn').disabled = true;
      break;
    case 'connecting':
      connectionIndicator.className = 'status-indicator';
      connectionText.textContent = 'Connecting...';
      document.getElementById('connect-btn').disabled = true;
      document.getElementById('disconnect-btn').disabled = true;
      break;
    case 'failed':
      connectionIndicator.className = 'status-indicator disconnected';
      connectionText.textContent = 'Connection Failed';
      document.getElementById('connect-btn').disabled = false;
      document.getElementById('disconnect-btn').disabled = true;
      break;
  }
}

// Update hand gesture icon
function updateGestureIcon(state) {
  if (state === 'OPEN') {
    handStatusElem.textContent = 'Hand Open';
    handStatusElem.className = 'gesture-text status-open';
    gestureIconElem.textContent = '🤚';
  } else if (state === 'CLOSED') {
    handStatusElem.textContent = 'Hand Closed';
    handStatusElem.className = 'gesture-text status-closed';
    gestureIconElem.textContent = '✊';
  } else {
    handStatusElem.textContent = 'No Hand';
    handStatusElem.className = 'gesture-text status-no-hand';
    gestureIconElem.textContent = '❌';
  }
}

// Event listeners
document.getElementById('connect-btn').addEventListener('click', startConnect);
document.getElementById('disconnect-btn').addEventListener('click', disconnect);
document.getElementById('clear-log').addEventListener('click', () => {
  mqttLogElem.innerHTML = '';
  log('info', 'Log cleared');
});
document.getElementById('export-log').addEventListener('click', () => {
  const logContent = mqttLogElem.innerText;
  const blob = new Blob([logContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gesture-vision-log-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  log('info', 'Log exported to file');
});

document.getElementById('enable_video').addEventListener('change', function() {
  if (this.checked && client && client.isConnected() && !streamInterval) {
    startVideoStreaming();
  } else if (!this.checked && streamInterval) {
    clearInterval(streamInterval);
    streamInterval = null;
    streamStatusElem.innerText = 'Disabled';
    streamStatusElem.className = 'stat-value status-disabled';
    log('info', 'Video streaming disabled');
  }
});

document.getElementById('enable_hand').addEventListener('change', function() {
  if (!this.checked) {
    log('info', 'Hand status publishing disabled');
  } else {
    log('info', 'Hand status publishing enabled');
    // Republish current state if available
    if (lastPublishedState && client && client.isConnected()) {
      publishState(lastPublishedState);
    }
  }
});

fpsSlider.addEventListener('input', function() {
  fpsValue.textContent = this.value + ' FPS';
  if (client && client.isConnected() && streamInterval) {
    startVideoStreaming(); // restart streaming at new FPS
  }
});

// Connect to MQTT broker
function startConnect() {
  const host = document.getElementById('host').value;
  const port = parseInt(document.getElementById('port_ws').value, 10);
  const clientID = 'webcamJS-' + Math.random().toString(16).substr(2,8);

  if (streamInterval) {
    clearInterval(streamInterval);
    streamInterval = null;
  }

  log('connect', `Connecting to ${host}:${port} as ${clientID}`);
  updateConnectionUI('connecting');
  
  client = new Paho.MQTT.Client(host, port, clientID);

  client.onConnectionLost = resp => {
    log('error', `Connection lost: ${resp.errorMessage}`);
    streamStatusElem.innerText = 'Disconnected';
    streamStatusElem.className = 'stat-value status-error';
    updateConnectionUI('disconnected');
    if (streamInterval) {
      clearInterval(streamInterval);
      streamInterval = null;
    }
  };
  
  client.connect({
    onSuccess: () => {
      log('success', `Connected successfully to ${host}:${port}`);
      updateConnectionUI('connected');
      if (document.getElementById('enable_video').checked) {
        startVideoStreaming();
      }
    },
    onFailure: e => {
      log('error', `Connection failed: ${e.errorMessage}`);
      streamStatusElem.innerText = 'Failed to connect';
      streamStatusElem.className = 'stat-value status-error';
      updateConnectionUI('failed');
    }
  });
}

// Disconnect from MQTT broker
function disconnect() {
  if (streamInterval) {
    clearInterval(streamInterval);
    streamInterval = null;
  }
  
  if (client) {
    client.disconnect();
    log('disconnect', 'Disconnected from broker');
    streamStatusElem.innerText = 'Disconnected';
    streamStatusElem.className = 'stat-value status-disabled';
    updateConnectionUI('disconnected');
  }
}

// Publish hand state
function publishState(state) {
  if (!document.getElementById('enable_hand').checked) return;
  
  if (client && client.isConnected() && state !== lastPublishedState) {
    const topic = document.getElementById('topic_p').value;
    const msg = new Paho.MQTT.Message(state);
    msg.destinationName = topic;
    client.send(msg);

    let cls = state === 'OPEN' ? 'open' : 
              state === 'CLOSED' ? 'closed' : 'no-hand';
    log('publish', `Hand: <span class="log-${cls}">${state}</span> → ${topic}`);
    lastPublishedState = state;
  }
}

// Start sending video frames
function startVideoStreaming() {
  if (streamInterval) {
    clearInterval(streamInterval);
  }

  const fps = parseInt(fpsSlider.value) || 10;
  const interval = 1000 / fps;
  lastFrameTime = Date.now();
  frameCount = 0;

  streamStatusElem.innerText = 'Starting stream...';
  streamStatusElem.className = 'stat-value status-warning';
  log('info', `Starting video stream at ${fps} FPS`);

  streamInterval = setInterval(() => {
    if (client && client.isConnected() && document.getElementById('enable_video').checked) {
      const videoTopic = document.getElementById('topic_v').value;
      const useBase64 = document.getElementById('use_base64').checked;

      // FPS calculation
      frameCount++;
      const now = Date.now();
      if (now - lastFrameTime >= 1000) {
        actualFps = frameCount;
        frameCount = 0;
        lastFrameTime = now;
        streamStatusElem.innerText = `Streaming (${actualFps} FPS)`;
        streamStatusElem.className = 'stat-value status-success';
      }

      // Grab JPEG from canvas
      const imageData = canvasElem.toDataURL('image/jpeg', 0.7);
      const base64Data = imageData.split(',')[1];

      if (useBase64) {
        const msg = new Paho.MQTT.Message(base64Data);
        msg.destinationName = videoTopic;
        client.send(msg);
        const sizeKB = Math.round((base64Data.length * 3/4) / 1024);
        log('stream', `Video frame: ${sizeKB}KB → ${videoTopic}`);
      } else {
        const binaryString = atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const msg = new Paho.MQTT.Message(bytes);
        msg.destinationName = videoTopic;
        client.send(msg);
        log('stream', `Video frame: ${Math.round(bytes.length/1024)}KB → ${videoTopic}`);
      }
    }
  }, interval);
}

// MediaPipe Hands setup
const hands = new Hands({
  locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});

hands.onResults(onResults);

modelStatusElem.textContent = 'Loading...';
hands.initialize().then(() => {
  modelLoaded = true;
  modelStatusElem.textContent = 'Ready';
  log('success', 'Hand tracking model loaded');
}).catch(err => {
  modelStatusElem.textContent = 'Failed';
  log('error', `Model initialization error: ${err.message}`);
});

// Camera init
function initCamera() {
  cameraStatusElem.textContent = 'Initializing...';
  
  new Camera(videoElem, {
    onFrame: async () => {
      try {
        if (modelLoaded) {
          await hands.send({image: videoElem});
        }
        
        if (!canvasElem.width || !canvasElem.height) {
          initCanvas();
        }
      } catch (err) {
        log('error', `Frame processing error: ${err.message}`);
      }
    },
    width: 640,
    height: 480
  }).start().then(() => {
    cameraInitialized = true;
    cameraStatusElem.textContent = 'Active';
    log('info', 'Camera initialized successfully');
  }).catch(error => {
    cameraStatusElem.textContent = 'Error';
    log('error', `Camera error: ${error.message}`);
  });
}

// Process each frame
function onResults(results) {
  // First initialize canvas if needed
  if (!canvasElem.width || !canvasElem.height) {
    initCanvas();
  }
  
  // Clear canvas and draw with proper aspect ratio
  ctx.save();
  ctx.clearRect(0, 0, canvasElem.width, canvasElem.height);
  
  // Draw the video frame
  ctx.drawImage(results.image, 0, 0, canvasElem.width, canvasElem.height);
  
  // Process hand landmarks if detected
  let state = "NO_HAND";
  if (results.multiHandLandmarks?.length) {
    const lm = results.multiHandLandmarks[0];
    
    // Draw hand connections with improved styling
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    drawConnectors(ctx, lm, HAND_CONNECTIONS);
    
    // Draw landmarks with larger size for fingertips
    for (let i = 0; i < lm.length; i++) {
      const isFingerTip = [4, 8, 12, 16, 20].includes(i);
      const radius = isFingerTip ? 6 : 4;
      
      ctx.beginPath();
      ctx.arc(lm[i].x * canvasElem.width, lm[i].y * canvasElem.height, radius, 0, 2 * Math.PI);
      
      if (isFingerTip) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
      } else {
        ctx.fillStyle = 'rgba(0, 217, 255, 0.8)';
      }
      ctx.fill();
      
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.stroke();
    }

    // Calculate if hand is open or closed based on finger positions
    const tips = [8,12,16,20], pips = [6,10,14,18];
    const count = tips.reduce((c,i) => c + (lm[i].y < lm[pips[tips.indexOf(i)]].y ? 1 : 0), 0);
    state = count >= 3 ? "OPEN" : "CLOSED";
  }

  // Update hand status display and icon
  updateGestureIcon(state);
  ctx.restore();

  // Publish state if changed
  publishState(state);
}

// Bootstrap
updateConnectionUI('disconnected');
document.getElementById('disconnect-btn').disabled = true;
initCamera();
log('info', 'System initialized');