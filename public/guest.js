let localStream;
let peerConnection;
let usingFrontCamera = true;
const ws = new WebSocket("wss://qah-news-signal.onrender.com");
const videoElement = document.getElementById("localVideo");

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

ws.onopen = async () => {
  ws.send(JSON.stringify({ type: "register", role: "guest" }));
  await initCamera(); // نشغّل الكاميرا ونبدأ البث
  await initConnection(); // نبدأ الاتصال
};

async function initCamera() {
  try {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
        facingMode: usingFrontCamera ? "user" : "environment"
      },
      audio: true
    };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = localStream;

  } catch (err) {
    console.error("Error accessing media devices:", err);
  }
}

async function initConnection() {
  peerConnection = new RTCPeerConnection(config);

  // إرسال تراكات الكاميرا والمايك
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
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

  peerConnection.ontrack = (event) => {
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
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
      facingMode: usingFrontCamera ? "user" : "environment"
    },
    audio: true
  });

  const videoTrack = newStream.getVideoTracks()[0];
  const audioTrack = newStream.getAudioTracks()[0];

  const senders = peerConnection.getSenders();
  const videoSender = senders.find(sender => sender.track.kind === 'video');
  const audioSender = senders.find(sender => sender.track.kind === 'audio');

  if (videoSender) await videoSender.replaceTrack(videoTrack);
  if (audioSender) await audioSender.replaceTrack(audioTrack);

  localStream.getTracks().forEach(track => track.stop());
  localStream = newStream;
  videoElement.srcObject = localStream;
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
