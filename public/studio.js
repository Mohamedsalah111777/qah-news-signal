let peerConnection;
let localStream;
const ws = new WebSocket("wss://qah-news-signal.onrender.com");
const videoElement = document.getElementById("remoteVideo");

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "register", role: "studio" }));
  initMic();
};

async function initMic() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    console.error("Mic error:", err);
  }
}

ws.onmessage = async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === "signal" && msg.from === "guest") {
    const { sdp, candidate } = msg.payload;

    if (!peerConnection) createPeerConnection();

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

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);

  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }

  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: "signal",
        role: "studio",
        target: "guest",
        payload: { candidate: event.candidate }
      }));
    }
  };

  peerConnection.ontrack = event => {
    const [stream] = event.streams;
    videoElement.srcObject = stream;
  };
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
