let localStream;
let peerConnection;
const ws = new WebSocket("wss://qah-news-signal.onrender.com");
const videoElement = document.getElementById("localVideo");
const cameraSelect = document.getElementById("cameraSelect");

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "register", role: "guest" }));
  listCameras();
};

async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(device => device.kind === "videoinput");

  cameraSelect.innerHTML = "";
  videoDevices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.text = device.label || `Camera ${index + 1}`;
    cameraSelect.appendChild(option);
  });

  cameraSelect.onchange = () => startCamera(cameraSelect.value);
  if (videoDevices.length > 0) {
    startCamera(videoDevices[0].deviceId);
  }
}

async function startCamera(deviceId) {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: true
    });

    videoElement.srcObject = localStream;

    if (peerConnection) peerConnection.close();
    createPeerConnection();
  } catch (err) {
    console.error("Error starting camera:", err);
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);

  localStream.getTracks().forEach(track => {
    const sender = peerConnection.addTrack(track, localStream);

    if (track.kind === 'video' && sender.setParameters) {
      const parameters = sender.getParameters();
      if (!parameters.encodings) parameters.encodings = [{}];
      parameters.encodings[0].maxBitrate = 2500000;
      sender.setParameters(parameters).catch(e => console.warn("Bitrate error:", e));
    }
  });

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

  peerConnection.ontrack = event => {
    const remoteStream = event.streams[0];
    const audio = new Audio();
    audio.srcObject = remoteStream;
    audio.autoplay = true;
    audio.play();
  };

  sendOffer();
}

async function sendOffer() {
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  ws.send(JSON.stringify({
    type: "signal",
    role: "guest",
    target: "studio",
    payload: { sdp: offer }
  }));
}

ws.onmessage = async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === "signal" && msg.from === "studio") {
    const { sdp, candidate } = msg.payload;

    if (sdp) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    }
    if (candidate) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }
};

function toggleFullscreen(videoId) {
  const video = document.getElementById(videoId);
  if (!document.fullscreenElement) {
    video.requestFullscreen().catch(err => {
      console.error(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
}
