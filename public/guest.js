let localStream;
let peerConnection;
let usingFrontCamera = true;
let videoSender;

const ws = new WebSocket("wss://qah-news-signal.onrender.com");
const videoElement = document.getElementById("localVideo");

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

ws.onopen = async () => {
  ws.send(JSON.stringify({ type: "register", role: "guest" }));
  await startStreamAndConnection();
};

async function startStreamAndConnection() {
  // جلب الفيديو والصوت
  localStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: usingFrontCamera ? "user" : "environment", width: 1920, height: 1080, frameRate: 30 },
    audio: true
  });

  videoElement.srcObject = localStream;

  // انشاء PeerConnection إذا مش موجود
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

    peerConnection.ontrack = event => {
      const remoteAudio = new Audio();
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play();
    };
  }

  // لو دي اول مرة نضيف المسارات
  if (!videoSender) {
    localStream.getTracks().forEach(track => {
      const sender = peerConnection.addTrack(track, localStream);
      if (track.kind === "video") {
        videoSender = sender;
      }
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    ws.send(JSON.stringify({
      type: "signal",
      role: "guest",
      target: "studio",
      payload: { sdp: offer }
    }));
  } else {
    // لو الpeerConnection موجود والvideoSender موجود، فقط بدّل فيديو الكاميرا بدون عمل Offer جديد
    const newVideoTrack = localStream.getVideoTracks()[0];
    await videoSender.replaceTrack(newVideoTrack);
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

async function toggleCamera() {
  usingFrontCamera = !usingFrontCamera;

  // توقف كاميرا قديمة قبل الحصول على الجديدة
  localStream.getTracks().forEach(track => track.stop());

  await startStreamAndConnection();
}
