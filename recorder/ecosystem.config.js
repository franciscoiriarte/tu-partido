module.exports = {
  apps: [{
    name: "recorder",
    script: "index.js",
    cwd: "/Users/franciscoiriarte/tu-partido/recorder",
    restart_delay: 5000,
    max_restarts: 10,
    autorestart: true,
  }],
};
