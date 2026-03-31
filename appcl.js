const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

let drawing = false;
let drawEnabled = false;

function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener("resize", resize);

/* LOAD VIDEO /
document.getElementById("videoInput").onchange = e => {
  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  video.src = url;
video.load();

video.oncanplay = () => {
  video.play().catch(err => {
    console.log("Play blocked:", err);
  });
};

  video.onloadeddata = () => {
    resize();
    console.log("Video loaded");
  };
};

/ ENABLE DRAW MODE WITH KEY D /
document.addEventListener("keydown", e => {
  if (e.key === "d") {
    drawEnabled = !drawEnabled;
    canvas.style.pointerEvents = drawEnabled ? "auto" : "none";
    console.log("Draw mode:", drawEnabled);
  }
});

/ DRAW */
canvas.onpointerdown = e => {
  if (!drawEnabled) return;
  drawing = true;
  ctx.beginPath();
  ctx.moveTo(e.offsetX, e.offsetY);
};

canvas.onpointermove = e => {
  if (!drawing) return;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#336699";
  ctx.lineTo(e.offsetX, e.offsetY);
  ctx.stroke();
};

canvas.onpointerup = () => drawing = false;
video.onclick = () => {
  if (video.paused) {
    video.play();
  } else {
    video.pause();
  }
};
