const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

let drawing = false;

function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener("resize", resize);
resize();

document.getElementById("videoInput").onchange = e => {
  video.src = URL.createObjectURL(e.target.files[0]);
};

canvas.onpointerdown = () => drawing = true;
canvas.onpointerup = () => drawing = false;

canvas.onpointermove = e => {
  if (!drawing) return;
  ctx.lineWidth = 3;
  ctx.lineTo(e.offsetX, e.offsetY);
  ctx.stroke();
};
