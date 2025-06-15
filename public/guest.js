let localStream;
let peerConnection;
let usingFrontCamera = true;
const ws = new WebSocket("wss://qah-news-signal.onrender.com");
const videoElement = document.getElementById("localVideo");

const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ]
};

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "register", role: "guest" }));
  initCamera();
};

async function initCamera() {
  try {
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

      peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE Connection State:", peerConnection.iceConnectionState);
      };

      peerConnection.ontrack = (event) => {
        const remoteAudio = new Audio();
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play();
      };
    }

    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

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

    if (sdp) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    }

    if (candidate && peerConnection.remoteDescription) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn("Failed to add ICE candidate:", err);
      }
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
