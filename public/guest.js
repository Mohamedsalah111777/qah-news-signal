// حالة التطبيق المحسنة
const appConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478?transport=udp" }
  ],
  reconnectOptions: {
    maxAttempts: 5,
    baseDelay: 1000,
    maxDelay: 30000
  }
};

class WebRTCClient {
  constructor() {
    this.state = {
      localStream: null,
      peerConnection: null,
      usingFrontCamera: true,
      isMicMuted: false,
      connectionStatus: 'disconnected',
      reconnectCount: 0
    };
    
    this.ws = null;
    this.mediaConstraints = {
      video: {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 30, min: 15 },
        facingMode: 'user'
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };
    
    this.initElements();
    this.initEventListeners();
    this.connectSignalingServer();
  }

  initElements() {
    this.videoElement = document.getElementById('localVideo');
    this.statusElement = document.getElementById('status');
    this.qualityElement = document.getElementById('connection-quality');
    this.micTextElement = document.getElementById('micText');
  }

  initEventListeners() {
    window.addEventListener('beforeunload', this.cleanup.bind(this));
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  connectSignalingServer() {
    this.ws = new WebSocket("wss://your-render-app.onrender.com");
    
    this.ws.onopen = () => {
      this.updateStatus("متصل بالخادم", "success");
      this.registerClient();
      this.initCamera();
    };
    
    this.ws.onclose = () => this.handleDisconnection();
    this.ws.onerror = (error) => this.handleError(error);
    this.ws.onmessage = (event) => this.handleMessage(event);
  }

  registerClient() {
    this.ws.send(JSON.stringify({ 
      type: "register", 
      role: "guest",
      metadata: {
        browser: navigator.userAgent,
        resolution: `${window.screen.width}x${window.screen.height}`,
        os: navigator.platform
      }
    }));
  }

  async initCamera() {
    try {
      this.updateStatus("جاري تهيئة الكاميرا...", "warning");
      
      if (this.state.localStream) {
        this.stopMediaTracks(this.state.localStream);
      }

      this.mediaConstraints.video.facingMode = 
        this.state.usingFrontCamera ? 'user' : 'environment';
      
      this.state.localStream = await navigator.mediaDevices.getUserMedia(
        this.mediaConstraints
      );
      
      this.videoElement.srcObject = this.state.localStream;
      this.initPeerConnection();
      this.updateStatus("الكاميرا جاهزة", "success");
    } catch (error) {
      this.handleMediaError(error);
    }
  }

  initPeerConnection() {
    if (this.state.peerConnection) {
      this.state.peerConnection.close();
    }

    this.state.peerConnection = new RTCPeerConnection({
      iceServers: appConfig.iceServers,
      iceTransportPolicy: "all"
    });

    this.setupPeerEventHandlers();
    this.addLocalTracks();
  }

  setupPeerEventHandlers() {
    this.state.peerConnection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.sendSignal({ candidate });
      }
    };

    this.state.peerConnection.oniceconnectionstatechange = () => {
      const state = this.state.peerConnection.iceConnectionState;
      this.state.connectionStatus = state;
      this.updateStatus(`حالة الاتصال: ${state}`, "info");
      
      if (state === "disconnected" || state === "failed") {
        this.scheduleReconnect();
      }
    };

    this.state.peerConnection.ontrack = (event) => {
      const remoteAudio = new Audio();
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch(console.error);
    };
  }

  addLocalTracks() {
    this.state.localStream.getTracks().forEach(track => {
      this.state.peerConnection.addTrack(track, this.state.localStream);
    });
  }

  async handleMessage(event) {
    try {
      const msg = JSON.parse(event.data);
      
      if (msg.type === "signal" && msg.from === "studio") {
        await this.processSignal(msg);
      } else if (msg.type === "connection-quality") {
        this.updateConnectionQuality(msg.quality);
      }
    } catch (error) {
      console.error("Error handling message:", error);
    }
  }

  async processSignal(msg) {
    const { sdp, candidate } = msg.payload;
    
    if (!this.state.peerConnection) {
      this.initPeerConnection();
    }
    
    if (sdp) {
      await this.state.peerConnection.setRemoteDescription(
        new RTCSessionDescription(sdp)
      );
      
      if (sdp.type === "offer") {
        await this.createAnswer();
      }
    }
    
    if (candidate) {
      try {
        await this.state.peerConnection.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
      }
    }
  }

  async createAnswer() {
    try {
      const answer = await this.state.peerConnection.createAnswer();
      await this.state.peerConnection.setLocalDescription(answer);
      this.sendSignal({ sdp: answer });
    } catch (error) {
      console.error("Error creating answer:", error);
      this.updateStatus("خطأ في إنشاء الاتصال", "error");
    }
  }

  sendSignal(payload) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "signal",
        role: "guest",
        target: "studio",
        payload
      }));
    }
  }

  handleDisconnection() {
    this.updateStatus("انقطع الاتصال بالخادم", "error");
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.state.reconnectCount < appConfig.reconnectOptions.maxAttempts) {
      const delay = Math.min(
        appConfig.reconnectOptions.baseDelay * Math.pow(2, this.state.reconnectCount),
        appConfig.reconnectOptions.maxDelay
      );
      
      setTimeout(() => {
        if (this.state.connectionStatus !== "connected") {
          this.state.reconnectCount++;
          this.connectSignalingServer();
        }
      }, delay);
    }
  }

  toggleCamera() {
    this.state.usingFrontCamera = !this.state.usingFrontCamera;
    this.initCamera();
  }

  toggleMic() {
    if (!this.state.localStream) return;
    
    const audioTracks = this.state.localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      this.state.isMicMuted = !this.state.isMicMuted;
      audioTracks[0].enabled = !this.state.isMicMuted;
      this.micTextElement.textContent = 
        this.state.isMicMuted ? 'تشغيل الميكروفون' : 'إيقاف الميكروفون';
      this.updateStatus(
        this.state.isMicMuted ? 'الميكروفون مكتوم' : 'الميكروفون نشط', 
        'info'
      );
    }
  }

  updateStatus(message, type) {
    if (this.statusElement) {
      this.statusElement.textContent = message;
      this.statusElement.style.color = 
        type === "success" ? "#4CAF50" :
        type === "error" ? "#F44336" :
        type === "warning" ? "#FFC107" : "#2196F3";
    }
  }

  updateConnectionQuality(quality) {
    if (this.qualityElement) {
      const levels = {
        excellent: { text: "ممتازة", color: "#4CAF50" },
        good: { text: "جيدة", color: "#8BC34A" },
        fair: { text: "متوسطة", color: "#FFC107" },
        poor: { text: "ضعيفة", color: "#F44336" }
      };
      
      const level = levels[quality] || levels.poor;
      this.qualityElement.textContent = `جودة الاتصال: ${level.text}`;
      this.qualityElement.style.color = level.color;
    }
  }

  handleError(error) {
    console.error("WebSocket error:", error);
    this.updateStatus("خطأ في الاتصال بالخادم", "error");
  }

  handleMediaError(error) {
    console.error("Media error:", error);
    
    let message = "خطأ في الوسائط";
    if (error.name === "NotAllowedError") {
      message = "تم رفض الإذن بالوصول إلى الكاميرا/الميكروفون";
    } else if (error.name === "NotFoundError") {
      message = "لم يتم العثور على جهاز الكاميرا";
    }
    
    this.updateStatus(`${message}: ${error.message}`, "error");
  }

  handleResize() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "device-update",
        resolution: `${window.innerWidth}x${window.innerHeight}`
      }));
    }
  }

  stopMediaTracks(stream) {
    stream.getTracks().forEach(track => track.stop());
  }

  cleanup() {
    if (this.ws) this.ws.close();
    if (this.state.peerConnection) this.state.peerConnection.close();
    if (this.state.localStream) this.stopMediaTracks(this.state.localStream);
  }
}

// تهيئة التطبيق عند تحميل الصفحة
document.addEventListener("DOMContentLoaded", () => {
  const client = new WebRTCClient();
  
  // تعريض الدوال للواجهة
  window.toggleCamera = () => client.toggleCamera();
  window.toggleMic = () => client.toggleMic();
  window.toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen();
    }
  };
});
