let localStream;
let peerConnection;
let usingFrontCamera = true;
let pendingCandidates = [];
const ws = new WebSocket("wss://qah-news-signal.onrender.com");
const videoElement = document.getElementById("localVideo");

const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ],
  iceTransportPolicy: "relay"
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
      pendingCandidates.forEach(async c => {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(c));
        } catch (err) {
          console.warn("Error applying stored ICE:", err);
        }
      });
      pendingCandidates = [];
    }

    if (candidate) {
      if (peerConnection.remoteDescription) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn("Failed to add ICE candidate:", err);
        }
      } else {
        pendingCandidates.push(candidate);
        console.log("Stored ICE candidate before remote description set");
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
