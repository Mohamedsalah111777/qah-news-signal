let localStream;
let peerConnection;
let videoSender;
let audioSender;
let usingFrontCamera = true;
const ws = new WebSocket("wss://qah-news-signal.onrender.com");
const videoElement = document.getElementById("localVideo");

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "register", role: "guest" }));
  startConnection();
};

async function startConnection() {
  try {
    await initCamera();

    if (!peerConnection) {
      createPeerConnection();
    }
  } catch (err) {
    console.error("Start connection error:", err);
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);

  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: "signal",
        role: "guest",
        target: "studio",
        payload: { candidate: event.candidate }
      }));
    }
  };

  peerConnection.ontrack = (event) => {
    // استقبال الصوت من الاستوديو
    if(event.track.kind === 'audio') {
      const remoteAudio = new Audio();
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch(() => { /* ممكن يرفض في بعض المتصفحات */ });
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection.iceConnectionState;
    console.log("ICE connection state:", state);
    if (state === "disconnected" || state === "failed") {
      console.warn("ICE disconnected or failed. إعادة الاتصال...");
      restartConnection();
    }
  };

  peerConnection.onnegotiationneeded = async () => {
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      ws.send(JSON.stringify({
        type: "signal",
        role: "guest",
        target: "studio",
        payload: { sdp: peerConnection.localDescription }
      }));
    } catch (err) {
      console.error("Negotiation error:", err);
    }
  };
}

async function initCamera() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  const videoConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
    facingMode: usingFrontCamera ? "user" : "environment"
  };

  localStream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: true
  });

  videoElement.srcObject = localStream;

  if (!peerConnection) {
    createPeerConnection();
  }

  // إزالة التراكات القديمة
  peerConnection.getSenders().forEach(sender => peerConnection.removeTrack(sender));

  // إضافة التراكات الجديدة
  localStream.getTracks().forEach(track => {
    const sender = peerConnection.addTrack(track, localStream);
    if (track.kind === "video") videoSender = sender;
    if (track.kind === "audio") audioSender = sender;
  });
}

async function restartConnection() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  await startConnection();
}

ws.onmessage = async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === "signal" && msg.from === "studio") {
    const { sdp, candidate } = msg.payload;

    try {
      if (sdp) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      }
      if (candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {
      console.error("Error handling signal:", err);
    }
  }
};

function toggleCamera() {
  usingFrontCamera = !usingFrontCamera;
  initCamera();
}

function toggleFullscreen(videoId) {
  const video = document.getElementById(videoId);
  if (!document.fullscreenElement) {
    video.requestFullscreen().catch(err => {
      console.error(`Error attempting fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
}
