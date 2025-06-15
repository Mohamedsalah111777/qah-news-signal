let localStream;
let peerConnection;
let currentFacingMode = "user";
const ws = new WebSocket("wss://qah-news-signal.onrender.com");
const videoElement = document.getElementById("localVideo");

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "register", role: "guest" }));
  initCamera();
};

async function initCamera() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });

    videoElement.srcObject = localStream;

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

function toggleCamera() {
  currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
  initCamera();
}

function toggleFullscreen(videoId) {
  const video = document.getElementById(videoId);
  if (!document.fullscreenElement) {
    video.requestFullscreen().catch(err => {
      console.error("Error attempting fullscreen:", err);
    });
  } else {
    document.exitFullscreen();
  }
}
