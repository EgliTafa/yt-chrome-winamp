// // This runs inside the Document PiP window.
// // It connects to the same SW and sends the same commands.

// const port = chrome.runtime.connect({ name: "ui" });

// document.body.className = "";
// document.body.style.margin = "12px";

// // Mini layout using your button styling
// document.body.innerHTML = `
//   <div class="maxamp-container" style="width: 340px;">
//     <div class="top-container">
//       <div class="title">
//         <div class="line line-first"></div>
//         <h1 style="width:auto; letter-spacing:.2rem;">PIP</h1>
//         <div class="line line-first"></div>
//       </div>

//       <div class="cmd-container">
//         <div class="btn-container">
//           <div class="btn-container--1" style="width:auto;">
//             <button class="nav-btn" data-nav="prev" title="Previous">⏮</button>
//             <button class="play-btn" title="Play">▶</button>
//             <button class="pause-btn" title="Pause">⏸</button>
//             <button class="stop-btn highlighted" title="Stop">⏹</button>
//             <button class="nav-btn" data-nav="next" title="Next">⏭</button>
//           </div>
//         </div>

//         <div style="margin-top:10px;">
//           <input class="volume-controller" type="range" min="0" max="100" value="100" step="1" />
//         </div>

//         <div class="status-bar" style="margin-top:10px;">
//           <span class="status-text">PIP Ready.</span>
//         </div>
//       </div>
//     </div>
//   </div>
// `;

// const qs = document.querySelector.bind(document);
// const qsall = document.querySelectorAll.bind(document);

// const statusText = qs(".status-text");
// const volumeController = qs(".volume-controller");

// function send(msg) { port.postMessage(msg); }

// qs(".play-btn").addEventListener("click", () => send({ type: "CMD", cmd: "PLAY" }));
// qs(".pause-btn").addEventListener("click", () => send({ type: "CMD", cmd: "PAUSE" }));
// qs(".stop-btn").addEventListener("click", () => send({ type: "CMD", cmd: "STOP" }));

// qsall(".nav-btn").forEach(btn => {
//   btn.addEventListener("click", () => {
//     if (btn.dataset.nav === "prev") send({ type: "CMD", cmd: "PREV" });
//     if (btn.dataset.nav === "next") send({ type: "CMD", cmd: "NEXT" });
//   });
// });

// volumeController.addEventListener("input", (e) => {
//   send({ type: "CMD", cmd: "VOLUME", value: Number(e.target.value || 0) });
// });

// port.onMessage.addListener((msg) => {
//   if (msg?.type === "STATUS") statusText.textContent = msg.text;
//   if (msg?.type === "PLAYER_INFO" && msg.title) statusText.textContent = msg.title;
// });
