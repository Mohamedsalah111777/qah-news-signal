// حالة التطبيق
const appState = {
  localStream: null,
  peerConnection: null,
  usingFrontCamera: true,
  isMicMuted: false,
  isConnected: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478?transport=udp" },
    { 
      urls: "turn:global.turn.twilio.com:3478?transport=udp",
      username: "YOUR_TWILIO_USERNAME",
      credential: "YOUR_TWILIO_CREDENTIAL"
    }
  ]
};

// عناصر DOM
const videoElement = document.getElementById("localVideo");
const statusElement = document.getElementById("status");
const qualityElement = document.getElementById("connection-quality");

// اتصال WebSocket مع إعادة الاتصال التلقائي
let ws;
function initWebSocket() {
  ws = new WebSocket("wss://qah-news-signal.onrender.com");

  ws.onopen = () => {
    updateStatus("متصل بالخادم", "success");
    appState.reconnectAttempts = 0;
    ws.send(JSON.stringify({ 
      type: "register", 
      role: "guest",
      metadata: {
        device: navigator.userAgent,
        resolution: `${window.screen.width}x${window.screen.height}`
      }
    }));
    initCamera();
  };

  ws.onclose = () => {
    updateStatus("انقطع الاتصال بالخادم", "error");
    if (appState.reconnectAttempts < appState.maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(2, appState.reconnectAttempts), 30000);
      setTimeout(initWebSocket, delay);
      appState.reconnectAttempts++;
    }
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
  };

  ws.onmessage = handleWebSocketMessage;
}

// معالجة رسائل WebSocket
async function handleWebSocketMessage({ data }) {
  try {
    const msg = JSON.parse(data);
    
    if (msg.type === "signal" && msg.from === "studio") {
      const { sdp, candidate } = msg.payload;

      if (sdp) {
        await appState.peerConnection.setRemoteDescription(
          new RTCSessionDescription(sdp)
        );
        
        if (sdp.type === "offer") {
          const answer = await appState.peerConnection.createAnswer();
          await appState.peerConnection.setLocalDescription(answer);
          ws.send(JSON.stringify({
            type: "signal",
            role: "guest",
            target: "studio",
            payload: { sdp: answer }
          }));
        }
      }
      
      if (candidate) {
        try {
          await appState.peerConnection.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
        } catch (err) {
          console.error("Error adding ICE candidate:", err);
        }
      }
    }
    
    // معالجة رسائل أخرى مثل جودة الاتصال
    if (msg.type === "connection-quality") {
      updateConnectionQuality(msg.level);
    }
  } catch (err) {
    console.error("Error handling message:", err);
  }
}

// تهيئة الكاميرا والصوت
async function initCamera() {
  try {
    updateStatus("جاري تهيئة الكاميرا...", "warning");
    
    // إيقاف أي تدفق سابق
    if (appState.localStream) {
      appState.localStream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
      video: {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 30, min: 15 },
        facingMode: appState.usingFrontCamera ? "user" : "environment"
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };

    appState.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = appState.localStream;
    
    // إعداد اتصال Peer
    initPeerConnection();
    
    updateStatus("الكاميرا جاهزة", "success");
  } catch (err) {
    console.error("Camera initialization error:", err);
    updateStatus(`خطأ في الكاميرا: ${err.message}`, "error");
    handleMediaError(err);
  }
}

// تهيئة اتصال PeerConnection
function initPeerConnection() {
  if (appState.peerConnection) {
    appState.peerConnection.close();
  }

  appState.peerConnection = new RTCPeerConnection({
    iceServers: appState.iceServers,
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require"
  });

  // إضافة معالجين ICE
  appState.peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) {
      ws.send(JSON.stringify({
        type: "signal",
        role: "guest",
        target: "studio",
        payload: { candidate }
      }));
    }
  };

  appState.peerConnection.oniceconnectionstatechange = () => {
    const state = appState.peerConnection.iceConnectionState;
    updateStatus(`حالة الاتصال: ${state}`, "info");
    
    if (state === "disconnected" || state === "failed") {
      reconnectPeer();
    }
  };

  appState.peerConnection.ontrack = (event) => {
    const remoteAudio = new Audio();
    remoteAudio.srcObject = event.streams[0];
    remoteAudio.play().catch(err => {
      console.error("Error playing remote audio:", err);
    });
  };

  // إضافة التدفق المحلي
  appState.localStream.getTracks().forEach(track => {
    appState.peerConnection.addTrack(track, appState.localStream);
  });
}

// إنشاء عرض اتصال
async function createOffer() {
  try {
    const offer = await appState.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false
    });
    
    await appState.peerConnection.setLocalDescription(offer);
    
    ws.send(JSON.stringify({
      type: "signal",
      role: "guest",
      target: "studio",
      payload: { sdp: offer }
    }));
  } catch (err) {
    console.error("Error creating offer:", err);
    updateStatus("خطأ في إنشاء الاتصال", "error");
  }
}

// إعادة الاتصال عند الفشل
function reconnectPeer() {
  if (appState.reconnectAttempts < appState.maxReconnectAttempts) {
    updateStatus("جاري إعادة الاتصال...", "warning");
    setTimeout(() => {
      initPeerConnection();
      createOffer();
      appState.reconnectAttempts++;
    }, 1000 * appState.reconnectAttempts);
  }
}

// تبديل الكاميرا
async function toggleCamera() {
  appState.usingFrontCamera = !appState.usingFrontCamera;
  await initCamera();
}

// تبديل الميكروفون
function toggleMic() {
  if (appState.localStream) {
    const audioTracks = appState.localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      appState.isMicMuted = !appState.isMicMuted;
      audioTracks[0].enabled = !appState.isMicMuted;
      updateStatus(
        appState.isMicMuted ? "الميكروفون مكتوم" : "الميكروفون نشط", 
        "info"
      );
    }
  }
}

// ملء الشاشة
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.error("Fullscreen error:", err);
    });
  } else {
    document.exitFullscreen();
  }
}

// تحديث حالة الواجهة
function updateStatus(message, type) {
  if (statusElement) {
    statusElement.textContent = message;
    statusElement.style.color = 
      type === "success" ? "#4CAF50" :
      type === "error" ? "#F44336" :
      type === "warning" ? "#FFC107" : "#2196F3";
  }
}

// تحديث جودة الاتصال
function updateConnectionQuality(quality) {
  if (qualityElement) {
    const colors = {
      excellent: "#4CAF50",
      good: "#8BC34A",
      fair: "#FFC107",
      poor: "#F44336"
    };
    
    qualityElement.style.color = colors[quality] || "#FFFFFF";
    qualityElement.textContent = `جودة الاتصال: ${quality}`;
  }
}

// معالجة أخطاء الوسائط
function handleMediaError(error) {
  console.error("Media error:", error);
  
  if (error.name === "NotAllowedError") {
    updateStatus("تم رفض الإذن بالوصول إلى الكاميرا/الميكروفون", "error");
  } else if (error.name === "NotFoundError") {
    updateStatus("لم يتم العثور على جهاز الكاميرا", "error");
  } else {
    updateStatus(`خطأ في الوسائط: ${error.message}`, "error");
  }
}

// بدء التطبيق عند تحميل الصفحة
document.addEventListener("DOMContentLoaded", () => {
  initWebSocket();
  
  // إضافة معالجين لأحداث الصفحة
  window.addEventListener("beforeunload", () => {
    if (ws) ws.close();
    if (appState.peerConnection) appState.peerConnection.close();
    if (appState.localStream) {
      appState.localStream.getTracks().forEach(track => track.stop());
    }
  });
  
  // مراقبة تغيير حجم النافذة
  window.addEventListener("resize", () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "device-update",
        resolution: `${window.innerWidth}x${window.innerHeight}`
      }));
    }
  });
});
