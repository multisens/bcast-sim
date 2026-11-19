// Asks for aviso.txt, a file of the carousel whose maxExpiresDelta is shorter
// than its cyclePeriod, and shows the answer: 200 while it is available, 404
// while it has not passed or has expired.
const POLL_INTERVAL_MS = 2000;
const STATUS_ID = 'aviso-status';

async function poll() {
    const response = await fetch('aviso.txt', { cache: 'no-store' });
    const text = response.ok ? await response.text() : '';
    show(`${response.status} ${text}`);
}

function pollAndShow() {
    poll().catch((error) => {
        show(error.message);
    });
}

function show(text) {
    document.getElementById(STATUS_ID).textContent = `aviso.txt: ${text}`;
}

pollAndShow();
setInterval(pollAndShow, POLL_INTERVAL_MS);
