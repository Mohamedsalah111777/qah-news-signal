let remoteVideo = document.getElementById("remoteVideo");
let peerConnection;
let localAudioStream;
let pendingCandidates = [];
let remoteDescriptionSet = false;

const ws = new WebSocket("wss://qah-news-signal.onrender.com");

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
  ws.send(JSON.stringify({ type: "register", role: "studio" }));
};

ws.onmessage = async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === "signal" && msg.from === "guest") {
    const { sdp, candidate } = msg.payload;

    if (!peerConnection) await startConnection();

    if (sdp) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      remoteDescriptionSet = true;

      // إضافة الـ ICE Candidates المؤجلة
      for (const c of pendingCandidates) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(c));
        } catch (err) {
          console.warn("Error adding pending candidate:", err);
        }
      }
      pendingCandidates = [];

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
      if (remoteDescriptionSet) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn("Error adding candidate:", err);
        }
      } else {
        pendingCandidates.push(candidate);
        console.log("Stored ICE candidate before remote description set");
      }
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

  peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE Connection State:", peerConnection.iceConnectionState);
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
