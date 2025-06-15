let localStream;
let peerConnection;
let usingFrontCamera = true;
let videoSender;
let audioSender;

const ws = new WebSocket("wss://qah-news-signal.onrender.com");
const videoElement = document.getElementById("localVideo");

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

ws.onopen = async () => {
  ws.send(JSON.stringify({ type: "register", role: "guest" }));
  await initCamera();
  await initPeerConnection();
};

async function initCamera() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  localStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: usingFrontCamera ? "user" : "environment", width: 1920, height: 1080, frameRate: 30 },
    audio: true
  });
  videoElement.srcObject = localStream;
}

async function initPeerConnection() {
  peerConnection = new RTCPeerConnection(config);

  localStream.getTracks().forEach(track => {
    const sender = peerConnection.addTrack(track, localStream);
    if (track.kind === 'video') videoSender = sender;
    if (track.kind === 'audio') audioSender = sender;
  });

  peerConnection.onicecandidate = e => {
    if (e.candidate) {
      ws.send(JSON.stringify({
        type: "signal",
        role: "guest",
        target: "studio",
        payload: { candidate: e.candidate }
      }));
    }
  };

  peerConnection.ontrack = event => {
    const remoteAudio = new Audio();
    remoteAudio.srcObject = event.streams[0];
    remoteAudio.play();
  };

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

async function toggleCamera() {
  usingFrontCamera = !usingFrontCamera;

  const newStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: usingFrontCamera ? "user" : "environment", width: 1920, height: 1080, frameRate: 30 },
    audio: true
  });

  const newVideoTrack = newStream.getVideoTracks()[0];
  const newAudioTrack = newStream.getAudioTracks()[0];

  await videoSender.replaceTrack(newVideoTrack);
  await audioSender.replaceTrack(newAudioTrack);

  localStream.getTracks().forEach(track => track.stop());
  localStream = newStream;
  videoElement.srcObject = localStream;
}
