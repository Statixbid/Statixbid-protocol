import { isStated } from "./register.js";
import { copyText, announce, flashDone } from "./copy.js";
import { initReveal, initProgress, initSpotlight, initParallax, initScrollSpy } from "./fx.js";
import { startMarket } from "./market.js";

// Contract slot: live only when the register says stated. The markup is rendered at build time.
const caBtn = document.getElementById("ca-copy");
if (caBtn && isStated("ca")) {
  caBtn.addEventListener("click", async () => {
    if (await copyText(caBtn.dataset.copy)) { flashDone(caBtn); announce("Contract address copied"); }
  });
}

initProgress();
initSpotlight();
initReveal();
initParallax();
initScrollSpy();
// Market follows the market-source record only; the contract state has no say.
startMarket();
