const serverCode = require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf8');
eval(serverCode);
