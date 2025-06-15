let localStream;
let peerConnection;
const ws = new WebSocket("wss://qah-news-signal.onrender.com");
const remoteVideo = document.getElementById("remoteVideo");

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "register", role: "studio" }));
  initStudioMedia();
};

async function initStudioMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
  } catch (e) {
    console.warn("Could not access local studio mic:", e);
  }
}

ws.onmessage = async ({ data }) => {
  const msg = JSON.parse(data);

  if (msg.type === "signal" && msg.from === "guest") {
    const { sdp, candidate } = msg.payload;

    if (!peerConnection) {
      peerConnection = new RTCPeerConnection(config);

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

      peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
      };

      // أرسل صوت الاستوديو للضيف
      if (localStream) {
        localStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, localStream);
        });
      }
    }

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

// enable fullscreen on video click
remoteVideo.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    remoteVideo.requestFullscreen().catch(err => {
      console.error("Fullscreen error:", err);
    });
  } else {
    document.exitFullscreen();
  }
});
