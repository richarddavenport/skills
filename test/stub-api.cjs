// Preloaded with `node -r` so cu.js talks to a fake ClickUp instead of the real one.
// Responses come from STUB_RESPONSES, a JSON array served in order, with the last one
// repeating. Each request is appended to the STUB_LOG file as a line of JSON.
const https = require('https');
const fs = require('fs');
const { EventEmitter } = require('events');

const responses = JSON.parse(process.env.STUB_RESPONSES || '[{"status":200,"body":{}}]');
let served = 0;

https.request = (opts, callback) => {
  const req = new EventEmitter();
  const chunks = [];
  req.write = chunk => chunks.push(Buffer.from(chunk));
  req.end = () => {
    const r = responses[Math.min(served++, responses.length - 1)];
    if (process.env.STUB_LOG) {
      const body = Buffer.concat(chunks).toString('latin1');
      fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ method: opts.method, path: opts.path, headers: opts.headers, body }) + '\n');
    }
    const res = new EventEmitter();
    res.statusCode = r.status;
    res.headers = r.headers || {};
    callback(res);
    process.nextTick(() => {
      res.emit('data', JSON.stringify(r.body ?? {}));
      res.emit('end');
    });
  };
  return req;
};
