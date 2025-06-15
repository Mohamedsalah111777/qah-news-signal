// حالة التطبيق
const appState = {
  peerConnection: null,
  remoteStream: null,
  localAudioStream: null,
  isAudioMuted: false,
  connectionStatus: 'disconnected',
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478?transport=udp" },
    { 
      urls: "turn:global.turn.twilio.com:3478?transport=udp",
      username: "YOUR_TWILIO_USERNAME",
      credential: "YOUR_TWILIO_CREDENTIAL"
    }
  ],
  statsInterval: null
};

// عناصر DOM
const remoteVideo = document.getElementById("remoteVideo");
const audioButton = document.getElementById("audioButton");
const audioButtonText = document.getElementById("audioButtonText");

// اتصال WebSocket
const ws = new WebSocket("wss://qah-news-signal.onrender.com");

ws.onopen = () => {
  updateStatus("متصل بخادم الإشارة", "success");
  ws.send(JSON.stringify({ 
    type: "register", 
    role: "studio",
    metadata: {
      location: window.location.hostname,
      bandwidth: "high"
    }
  }));
};

ws.onclose = () => {
  updateStatus("انقطع الاتصال بالخادم", "error");
  cleanupConnection();
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
  updateStatus("خطأ في الاتصال بالخادم", "error");
};

ws.onmessage = async ({ data }) => {
  try {
    const msg = JSON.parse(data);
    
    if (msg.type === "signal" && msg.from === "guest") {
      await handleSignalMessage(msg);
    } else if (msg.type === "chat") {
      showChatMessage(msg);
    }
  } catch (err) {
    console.error("Error handling message:", err);
  }
};

// معالجة رسائل الإشارة
async function handleSignalMessage(msg) {
  const { sdp, candidate } = msg.payload;

  if (sdp) {
    if (!appState.peerConnection) {
      await initializePeerConnection();
    }
    
    await appState.peerConnection.setRemoteDescription(
      new RTCSessionDescription(sdp)
    );
    
    if (sdp.type === "offer") {
      const answer = await appState.peerConnection.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await appState.peerConnection.setLocalDescription(answer);
      
      ws.send(JSON.stringify({
        type: "signal",
        role: "studio",
        target: "guest",
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

// تهيئة اتصال PeerConnection
async function initializePeerConnection() {
  cleanupConnection();
  
  appState.peerConnection = new RTCPeerConnection({
    iceServers: appState.iceServers,
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle"
  });

  // معالج الأحداث
  appState.peerConnection.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      appState.remoteStream = event.streams[0];
      remoteVideo.srcObject = appState.remoteStream;
      updateStatus("تم استقبال البث من الضيف", "success");
      updateConnectionUI(true);
      startMonitoringStats();
    }
  };

  appState.peerConnection.oniceconnectionstatechange = () => {
    const state = appState.peerConnection.iceConnectionState;
    appState.connectionStatus = state;
    
    updateStatus(`حالة الاتصال: ${state}`, "info");
    updateConnectionUI(state === "connected");
    
    if (state === "disconnected" || state === "failed") {
      setTimeout(() => {
        if (appState.connectionStatus !== "connected") {
          reconnect();
        }
      }, 2000);
    }
  };

  appState.peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: "signal",
        role: "studio",
        target: "guest",
        payload: { candidate: event.candidate }
      }));
    }
  };

  // إضافة تدفق الصوت المحلي
  try {
    appState.localAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    appState.localAudioStream.getTracks().forEach(track => {
      appState.peerConnection.addTrack(track, appState.localAudioStream);
    });
  } catch (err) {
    console.warn("Audio input not available:", err);
    updateStatus("لم يتم العثور على ميكروفون", "warning");
  }
}

// مراقبة إحصائيات الاتصال
function startMonitoringStats() {
  if (appState.statsInterval) clearInterval(appState.statsInterval);
  
  appState.statsInterval = setInterval(async () => {
    if (!appState.peerConnection) return;
    
    try {
      const stats = await appState.peerConnection.getStats();
      let audioStats = { packetsLost: 0, totalPackets: 0 };
      
      stats.forEach(report => {
        if (report.type === "inbound-rtp" && report.kind === "audio") {
          audioStats.packetsLost += report.packetsLost;
          audioStats.totalPackets += report.packetsReceived + report.packetsLost;
        }
      });
      
      const packetLoss = audioStats.totalPackets > 0 ? 
        (audioStats.packetsLost / audioStats.totalPackets) : 0;
      
      updateConnectionQuality(1 - packetLoss);
    } catch (err) {
      console.error("Error getting stats:", err);
    }
  }, 3000);
}

// إعادة الاتصال
function reconnect() {
  if (appState.connectionStatus === "connected") return;
  
  updateStatus("جاري إعادة الاتصال...", "warning");
  ws.send(JSON.stringify({
    type: "reconnect",
    role: "studio"
  }));
}

// تنظيف الاتصال
function cleanupConnection() {
  if (appState.statsInterval) {
    clearInterval(appState.statsInterval);
    appState.statsInterval = null;
  }
  
  if (appState.peerConnection) {
    appState.peerConnection.close();
    appState.peerConnection = null;
  }
  
  if (appState.remoteStream) {
    appState.remoteStream.getTracks().forEach(track => track.stop());
    appState.remoteStream = null;
  }
  
  remoteVideo.srcObject = null;
  updateConnectionUI(false);
}

// تبديل حالة الميكروفون
function toggleAudio() {
  if (!appState.localAudioStream) return;
  
  appState.isAudioMuted = !appState.isAudioMuted;
  appState.localAudioStream.getAudioTracks().forEach(track => {
    track.enabled = !appState.isAudioMuted;
  });
  
  audioButtonText.textContent = appState.isAudioMuted ? 'تشغيل الصوت' : 'كتم الصوت';
  updateStatus(appState.isAudioMuted ? 'الميكروفون مكتوم' : 'الميكروفون نشط', 'info');
}

// إرسال رسالة للضيف
function sendMessageToGuest() {
  const message = prompt('أدخل الرسالة للضيف:', 'شكراً على المشاركة!');
  if (message) {
    ws.send(JSON.stringify({
      type: "chat",
      from: "studio",
      message: message
    }));
    updateStatus(`تم إرسال الرسالة: "${message}"`, 'success');
  }
}

// عرض رسالة دردشة
function showChatMessage(msg) {
  // يمكن تنفيذ واجهة عرض الرسائل هنا
  console.log(`رسالة من ${msg.from}: ${msg.message}`);
  updateStatus(`رسالة جديدة من الضيف`, 'info');
}

// تحديث جودة الاتصال في الواجهة
function updateConnectionQuality(quality) {
  const qualityBar = document.getElementById('qualityBar');
  const qualityText = document.getElementById('qualityText');
  
  if (qualityBar && qualityText) {
    qualityBar.style.transform = `scaleX(${quality})`;
    qualityText.textContent = `${Math.round(quality * 100)}%`;
  }
}

// تحديث واجهة حالة الاتصال
function updateConnectionUI(isConnected) {
  const connectionStatus = document.getElementById('connectionStatus');
  const videoStatus = document.getElementById('videoStatus');
  const audioStatus = document.getElementById('audioStatus');
  
  if (isConnected) {
    connectionStatus.classList.add('active');
    videoStatus.classList.add('active');
    audioStatus.classList.add('active');
  } else {
    connectionStatus.classList.remove('active');
    videoStatus.classList.remove('active');
    audioStatus.classList.remove('active');
  }
}

// تحديث حالة التطبيق
function updateStatus(message, type) {
  console.log(`[${type}] ${message}`);
  // يمكن إضافة عرض الرسائل للمستخدم
}

// تنظيف عند إغلاق الصفحة
window.addEventListener('beforeunload', () => {
  cleanupConnection();
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
});

// تهيئة الأزرار
document.addEventListener('DOMContentLoaded', () => {
  audioButton.addEventListener('click', toggleAudio);
});
