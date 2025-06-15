let localStream;
let peerConnection;
let videoSender;  // علشان نبدل التراك بدل إعادة إضافة كامل
let usingFrontCamera = true;
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

      peerConnection.ontrack = (event) => {
        // استقبل صوت من الاستوديو (لو موجود)
        const remoteAudio = new Audio();
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play();
      };

      peerConnection.onnegotiationneeded = async () => {
        try {
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          ws.send(JSON.stringify({
            type: "signal",
            role: "guest",
            target: "studio",
            payload: { sdp: peerConnection.localDescription }
          }));
        } catch (err) {
          console.error("Negotiation error:", err);
        }
      };
    }

    if (!videoSender) {
      localStream.getTracks().forEach(track => {
        const sender = peerConnection.addTrack(track, localStream);
        if (track.kind === "video") {
          videoSender = sender;
        }
      });
    } else {
      // لما نبدل الكاميرا نبدل التراك فقط
      const newVideoTrack = localStream.getVideoTracks()[0];
      await videoSender.replaceTrack(newVideoTrack);
    }

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
    if (candidate) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
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
