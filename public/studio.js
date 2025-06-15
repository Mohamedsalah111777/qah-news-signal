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
      urls: "turn:numb.viagenie.ca",
      username: "webrtc@live.com",
      credential: "muazkh"
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

      // إضافة الـ candidates المؤجلة بعد ضبط الـ SDP
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
    } else if (candidate) {
      if (remoteDescriptionSet) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn("Error adding candidate:", err);
        }
      } else {
        // خزّنه مؤقتًا لحد ما يتعمل setRemoteDescription
        pendingCandidates.push(candidate);
        console.log("Candidate received before remoteDescription; storing temporarily");
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
