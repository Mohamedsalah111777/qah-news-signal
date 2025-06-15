let remoteVideo = document.getElementById("remoteVideo");
let peerConnection;
let localAudioStream;
const ws = new WebSocket("wss://qah-news-signal.onrender.com");

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "register", role: "studio" }));
};

ws.onmessage = async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === "signal" && msg.from === "guest") {
    const { sdp, candidate } = msg.payload;

    if (!peerConnection) startConnection();

    if (sdp) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      ws.send(JSON.stringify({
        type: "signal",
        role: "studio",
        target: "guest",
        payload: { sdp: answer }
      }));
    }

    if (candidate) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }
};

async function startConnection() {
  peerConnection = new RTCPeerConnection(config);

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: "signal",
        role: "studio",
        target: "guest",
        payload: { candidate: event.candidate }
      }));
    }
  };

  try {
    localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localAudioStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localAudioStream);
    });
  } catch (err) {
    console.warn("Audio input not available:", err);
  }
}

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
