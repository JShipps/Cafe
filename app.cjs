// Startup file for Phusion Passenger (cPanel "Setup Node.js App").
// Passenger loads its startup file with require(), which can't load an ES module directly,
// and server.js only auto-starts when run as `node server.js` — so start it explicitly here.
import('./server.js')
  .then(({ start }) => start())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
