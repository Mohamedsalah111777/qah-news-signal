class StudioController {
  constructor() {
    this.config = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478?transport=udp" },
        { 
          urls: "turn:global.turn.twilio.com:3478?transport=udp",
          username: "YOUR_TWILIO_USERNAME",
          credential: "YOUR_TWILIO_CREDENTIAL"
        }
      ],
      reconnectPolicy: {
        maxAttempts: 5,
        baseDelay: 1000,
        maxDelay: 30000
      }
    };

    this.state = {
      peerConnection: null,
      remoteStream: null,
      localAudioStream: null,
      isAudioMuted: false,
      connectionStatus: 'disconnected',
      reconnectAttempts: 0,
      statsMonitor: null
    };

    this.initElements();
    this.initEventListeners();
    this.connectSignalingServer();
  }

  initElements() {
    this.remoteVideo = document.getElementById('remoteVideo');
    this.audioButton = document.getElementById('audioButton');
    this.audioButtonText = document.getElementById('audioButtonText');
    this.qualityBar = document.getElementById('qualityBar');
    this.qualityText = document.getElementById('qualityText');
    this.connectionStatus = document.getElementById('connectionStatus');
    this.connectionStatusText = document.getElementById('connectionStatusText');
    this.videoStatus = document.getElementById('videoStatus');
    this.videoStatusText = document.getElementById('videoStatusText');
    this.audioStatus = document.getElementById('audioStatus');
    this.audioStatusText = document.getElementById('audioStatusText');
  }

  initEventListeners() {
    this.audioButton.addEventListener('click', () => this.toggleAudio());
    window.addEventListener('beforeunload', () => this.cleanup());
  }

  connectSignalingServer() {
    this.ws = new WebSocket("wss://qah-news-signal.onrender.com");

    this.ws.onopen = () => {
      this.updateStatus("متصل بخادم الإشارة", "success");
      this.registerStudio();
    };

    this.ws.onclose = () => this.handleDisconnection();
    this.ws.onerror = (error) => this.handleError(error);
    this.ws.onmessage = (event) => this.handleMessage(event);
  }

  registerStudio() {
    this.ws.send(JSON.stringify({ 
      type: "register", 
      role: "studio",
      metadata: {
        location: window.location.hostname,
        bandwidth: "high",
        version: "1.0.0"
      }
    }));
  }

  async handleMessage(event) {
    try {
      const msg = JSON.parse(event.data);
      
      switch(msg.type) {
        case "signal":
          if (msg.from === "guest") {
            await this.processSignal(msg);
          }
          break;
        case "chat":
          this.showChatMessage(msg);
          break;
        case "connection-quality":
          this.updateConnectionQuality(msg.quality);
          break;
      }
    } catch (error) {
      this.handleError(error, "معالجة الرسالة");
    }
  }

  async processSignal(msg) {
    const { sdp, candidate } = msg.payload;

    if (sdp) {
      if (!this.state.peerConnection) {
        await this.initPeerConnection();
      }
      
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
        this.handleError(error, "إضافة مرشح ICE");
      }
    }
  }

  async initPeerConnection() {
    this.cleanupConnection();

    try {
      this.state.peerConnection = new RTCPeerConnection({
        iceServers: this.config.iceServers,
        iceTransportPolicy: "all"
      });

      this.setupPeerEventHandlers();
      await this.setupLocalAudio();
    } catch (error) {
      this.handleError(error, "تهيئة اتصال Peer");
    }
  }

  setupPeerEventHandlers() {
    this.state.peerConnection.ontrack = (event) => {
      if (event.streams?.[0]) {
        this.handleRemoteStream(event.streams[0]);
      }
    };

    this.state.peerConnection.oniceconnectionstatechange = () => {
      const state = this.state.peerConnection.iceConnectionState;
      this.state.connectionStatus = state;
      
      this.updateStatus(`حالة الاتصال: ${state}`, "info");
      this.updateConnectionUI(state === "connected");
      
      if (state === "disconnected" || state === "failed") {
        this.scheduleReconnect();
      }
    };

    this.state.peerConnection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.sendSignal({ candidate });
      }
    };
  }

  async setupLocalAudio() {
    try {
      this.state.localAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      
      this.state.localAudioStream.getTracks().forEach(track => {
        this.state.peerConnection.addTrack(track, this.state.localAudioStream);
      });
    } catch (error) {
      this.updateStatus("تعطيل الميكروفون المحلي", "warning");
      console.warn("لا يتوفر ميكروفون:", error);
    }
  }

  handleRemoteStream(stream) {
    this.state.remoteStream = stream;
    this.remoteVideo.srcObject = stream;
    this.updateStatus("تم استقبال البث من الضيف", "success");
    this.startStatsMonitoring();
  }

  async createAnswer() {
    try {
      const answer = await this.state.peerConnection.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await this.state.peerConnection.setLocalDescription(answer);
      this.sendSignal({ sdp: answer });
    } catch (error) {
      this.handleError(error, "إنشاء إجابة الاتصال");
    }
  }

  sendSignal(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "signal",
        role: "studio",
        target: "guest",
        payload
      }));
    }
  }

  startStatsMonitoring() {
    this.stopStatsMonitoring();
    
    this.state.statsMonitor = setInterval(async () => {
      try {
        const stats = await this.state.peerConnection.getStats();
        let audioStats = { packetsLost: 0, totalPackets: 0 };
        
        stats.forEach(report => {
          if (report.type === "inbound-rtp" && report.kind === "audio") {
            audioStats.packetsLost += report.packetsLost;
            audioStats.totalPackets += report.packetsReceived + report.packetsLost;
          }
        });
        
        const packetLoss = audioStats.totalPackets > 0 ? 
          (audioStats.packetsLost / audioStats.totalPackets) : 0;
        
        this.updateConnectionQuality(1 - packetLoss);
      } catch (error) {
        console.error("Error getting stats:", error);
      }
    }, 3000);
  }

  stopStatsMonitoring() {
    if (this.state.statsMonitor) {
      clearInterval(this.state.statsMonitor);
      this.state.statsMonitor = null;
    }
  }

  toggleAudio() {
    if (!this.state.localAudioStream) return;
    
    this.state.isAudioMuted = !this.state.isAudioMuted;
    this.state.localAudioStream.getAudioTracks().forEach(track => {
      track.enabled = !this.state.isAudioMuted;
    });
    
    this.audioButtonText.textContent = 
      this.state.isAudioMuted ? 'تشغيل الصوت' : 'كتم الصوت';
    this.updateStatus(
      this.state.isAudioMuted ? 'الميكروفون مكتوم' : 'الميكروفون نشط', 
      'info'
    );
  }

  sendMessageToGuest() {
    const message = prompt('أدخل الرسالة للضيف:', 'شكراً على المشاركة!');
    if (message) {
      this.ws.send(JSON.stringify({
        type: "chat",
        from: "studio",
        message: message
      }));
      this.updateStatus(`تم إرسال الرسالة: "${message}"`, 'success');
    }
  }

  showChatMessage(msg) {
    console.log(`رسالة من ${msg.from}: ${msg.message}`);
    this.updateStatus(`رسالة جديدة من الضيف`, 'info');
    // يمكن إضافة واجهة عرض الرسائل هنا
  }

  handleDisconnection() {
    this.updateStatus("انقطع الاتصال بالخادم", "error");
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.state.reconnectAttempts < this.config.reconnectPolicy.maxAttempts) {
      const delay = Math.min(
        this.config.reconnectPolicy.baseDelay * Math.pow(2, this.state.reconnectAttempts),
        this.config.reconnectPolicy.maxDelay
      );
      
      setTimeout(() => {
        if (this.state.connectionStatus !== "connected") {
          this.state.reconnectAttempts++;
          this.connectSignalingServer();
        }
      }, delay);
    }
  }

  handleError(error, context = "") {
    console.error(`Error ${context}:`, error);
    this.updateStatus(`خطأ: ${context}`, "error");
  }

  updateConnectionQuality(quality) {
    if (this.qualityBar && this.qualityText) {
      this.qualityBar.style.transform = `scaleX(${quality})`;
      this.qualityText.textContent = `${Math.round(quality * 100)}%`;
    }
  }

  updateConnectionUI(isConnected) {
    const indicators = [
      { element: this.connectionStatus, text: this.connectionStatusText, value: isConnected ? 'متصل' : 'غير متصل' },
      { element: this.videoStatus, text: this.videoStatusText, value: isConnected ? 'الفيديو نشط' : 'لا يوجد فيديو' },
      { element: this.audioStatus, text: this.audioStatusText, value: isConnected ? 'الصوت نشط' : 'لا يوجد صوت' }
    ];

    indicators.forEach(({ element, text, value }) => {
      element.classList.toggle('active', isConnected);
      text.textContent = value;
    });
  }

  updateStatus(message, type) {
    console.log(`[${type}] ${message}`);
    // يمكن إضافة عرض الرسائل في الواجهة
  }

  cleanupConnection() {
    this.stopStatsMonitoring();
    
    if (this.state.peerConnection) {
      this.state.peerConnection.close();
      this.state.peerConnection = null;
    }
    
    if (this.state.remoteStream) {
      this.state.remoteStream.getTracks().forEach(track => track.stop());
      this.state.remoteStream = null;
    }
    
    this.remoteVideo.srcObject = null;
    this.updateConnectionUI(false);
  }

  cleanup() {
    this.cleanupConnection();
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    
    if (this.state.localAudioStream) {
      this.state.localAudioStream.getTracks().forEach(track => track.stop());
    }
  }
}

// تهيئة التطبيق عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
  const studio = new StudioController();
  
  // تعريض الوظائف للواجهة
  window.toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen();
    }
  };
  
  window.sendMessageToGuest = () => studio.sendMessageToGuest();
});
