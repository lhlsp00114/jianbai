<template>
  <div class="canvasIntro">
    <div class="nodeGraph">
      <svg class="wires" viewBox="0 0 400 240" fill="none" aria-hidden="true">
        <path d="M123 114 C155 114 137 98 165 98 M247 98 C277 98 263 147 295 147" />
        <path class="signal" pathLength="100" d="M123 114 C155 114 137 98 165 98 M247 98 C277 98 263 147 295 147" />
      </svg>
      <span class="card textCard">
        <span class="textLines"><i></i><i></i><i></i></span>
        <i class="port output"></i>
      </span>
      <span class="card imageCard">
        <span class="landscape"></span>
        <i class="port input"></i><i class="port output"></i>
      </span>
      <span class="card videoCard">
        <span class="play"></span>
        <i class="port input"></i>
      </span>
    </div>
  </div>
</template>

<style scoped>
.canvasIntro {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  background:
    radial-gradient(ellipse at center, transparent 25%, #181b20d9 80%),
    radial-gradient(circle, #747f9057 1px, transparent 1.2px) center / 17px 17px;
}

.nodeGraph {
  position: relative;
  width: min(90%, 510px);
  aspect-ratio: 5 / 3;
}

.wires {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  stroke: #53616d;
  stroke-width: 1.5;
}

.signal {
  stroke: #a9dbc9;
  stroke-dasharray: 12 188;
  opacity: 0;
  animation: trace 5s ease-in-out infinite;
}

.card {
  position: absolute;
  display: grid;
  place-items: center;
  border: 1px solid #434b55;
  border-radius: 12px;
  background: #22272e;
  box-shadow: 0 8px 22px #11131770;
}

.textCard { inset: 32.5% 69.25% 37.5% 9%; }
.imageCard { inset: 20% 38.25% 34% 41.25%; border-color: #6a958a; }
.videoCard { inset: 47% 5% 24.5% 73.75%; }

.port {
  position: absolute;
  top: 50%;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a9dbc9;
  transform: translateY(-50%);
}

.input { left: -4px; }
.output { right: -4px; }
.imageCard .port { top: 45%; }

.textLines { display: grid; gap: 5px; width: 54%; }
.textLines i { height: 2px; border-radius: 2px; background: #8894a1; }
.textLines i:nth-child(2) { width: 75%; }
.textLines i:nth-child(3) { width: 48%; }

.landscape {
  position: relative;
  width: 73%;
  height: 70%;
  overflow: hidden;
  border-radius: 7px;
  background: #354941;
}

.landscape::before {
  content: "";
  position: absolute;
  inset: 37% 0 0;
  background: #81ab9a;
  clip-path: polygon(0 78%, 33% 18%, 53% 51%, 75% 0, 100% 65%, 100% 100%, 0 100%);
}

.landscape::after {
  content: "";
  position: absolute;
  top: 20%;
  left: 24%;
  width: 13%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: #e5d9aa;
}

.play {
  width: 20%;
  aspect-ratio: 1;
  background: #c5ced8;
  clip-path: polygon(15% 0, 100% 50%, 15% 100%);
}

@keyframes trace {
  0%, 10% { stroke-dashoffset: 12; opacity: 0; }
  25%, 55% { opacity: 1; }
  72%, 100% { stroke-dashoffset: -100; opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .signal { animation: none; }
}
</style>
