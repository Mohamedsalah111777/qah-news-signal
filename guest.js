let localStream;
const videoElement = document.getElementById('localVideo');

async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoElement.srcObject = localStream;

    // لاحقًا: إرسال الـ stream إلى signaling server
    console.log("Camera and mic access granted.");
  } catch (err) {
    console.error("Error accessing media devices.", err);
    alert("Camera/Mic access denied or unavailable.");
  }
}

initCamera();