const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

let drawing = false;
let drawEnabled = false; // IMPORTANT

function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener("resize", resize);

/* LOAD VIDEO /
document.getElementById("videoInput").onchange = e => {
  const file = e.target.files[0];
  if (!file) return;

  video.src = URL.createObjectURL(file);

  video.onloadedmetadata = () => {
    resize(); // FIX alignment
  };
};

/ ENABLE DRAW ONLY WHEN HOLDING CLICK /
canvas.onpointerdown = e => {
  if (!drawEnabled) return;
  drawing = true;
  ctx.beginPath();
  ctx.moveTo(e.offsetX, e.offsetY);
};

canvas.onpointermove = e => {
  if (!drawing) return;
  ctx.lineWidth = 3;
  ctx.lineTo(e.offsetX, e.offsetY);
  ctx.stroke();
};

canvas.onpointerup = () => drawing = false;

/ TOGGLE DRAW MODE WITH KEY "D" */
document.addEventListener("keydown", e => {
  if (e.key === "d") {
    drawEnabled = !drawEnabled;
    console.log("Draw mode:", drawEnabled);
  }
});
