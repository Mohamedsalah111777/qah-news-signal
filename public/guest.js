let localStream;
let peerConnection;
let selectedDeviceId = null;
const ws = new WebSocket("wss://qah-news-signal.onrender.com");
const videoElement = document.getElementById("localVideo");
const cameraSelect = document.getElementById("cameraSelect");

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "register", role: "guest" }));
  loadCameras();
};

cameraSelect.onchange = () => {
  selectedDeviceId = cameraSelect.value;
  initCamera();
};

async function loadCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(device => device.kind === 'videoinput');
  cameraSelect.innerHTML = '';
  videoDevices.forEach(device => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.text = device.label || `Camera ${cameraSelect.length + 1}`;
    cameraSelect.appendChild(option);
  });
  if (videoDevices.length > 0) {
    selectedDeviceId = videoDevices[0].deviceId;
    initCamera();
  }
}

async function initCamera() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: true
    });

    videoElement.srcObject = localStream;

    peerConnection = new RTCPeerConnection(config);
    localStream.getTracks().forEach(track => {
      const sender = peerConnection.addTrack(track, localStream);
      if (track.kind === 'video' && sender.setParameters) {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = 2500000;
        sender.setParameters(params).catch(e => console.warn("Bitrate error:", e));
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

    peerConnection.ontrack = (event) => {
      // استقبل صوت الاستوديو بدون إرسال الصوت الخاص بالضيف له
      const audio = new Audio();
      audio.srcObject = event.streams[0];
      audio.autoplay = true;
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    ws.send(JSON.stringify({
      type: "signal",
      role: "guest",
      target: "studio",
      payload: { sdp: offer }
    }));
  } catch (err) {
    console.error("Media error:", err);
  }
}

ws.onmessage = async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === "signal" && msg.from === "studio") {
    const { sdp, candidate } = msg.payload;
    if (sdp) await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    if (candidate) await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }
};
