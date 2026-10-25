import { createServer as createHttpServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer as createViteServer } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(root, 'data');
const submissionsFile = path.join(dataDirectory, 'contact-submissions.json');
const production = process.argv.includes('--production');
const maximumBodyBytes = 8 * 1024;
const rateLimitWindowMs = 10 * 60 * 1000;
const rateLimitMaximum = 5;
const rateLimits = new Map();
let saveQueue = Promise.resolve();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBodyBytes) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function validateSubmission(payload) {
  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const message = typeof payload?.message === 'string' ? payload.message.trim() : '';

  if (!name || name.length > 100) {
    return { error: 'Enter a name between 1 and 100 characters.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { error: 'Enter a valid email address.' };
  }
  if (!message || message.length > 3000) {
    return { error: 'Enter a message between 1 and 3000 characters.' };
  }
  if (payload.consent !== true) {
    return { error: 'Consent is required before details can be stored.' };
  }

  return {
    submission: {
      id: randomUUID(),
      name,
      email,
      message,
      consent: true,
      receivedAt: new Date().toISOString(),
    },
  };
}

function checkRateLimit(request) {
  const now = Date.now();
  const address = request.socket.remoteAddress ?? 'unknown';
  const recentRequests = (rateLimits.get(address) ?? []).filter((time) => now - time < rateLimitWindowMs);

  if (recentRequests.length >= rateLimitMaximum) {
    return false;
  }

  recentRequests.push(now);
  rateLimits.set(address, recentRequests);
  return true;
}

async function saveSubmission(submission) {
  const write = saveQueue.then(async () => {
    await mkdir(dataDirectory, { recursive: true });

    let submissions = [];
    try {
      const content = await readFile(submissionsFile, 'utf8');
      submissions = JSON.parse(content);
      if (!Array.isArray(submissions)) {
        throw new Error('Contact submissions file must contain a JSON array.');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    submissions.push(submission);
    const temporaryFile = path.join(dataDirectory, `.contact-submissions-${randomUUID()}.tmp`);
    await writeFile(temporaryFile, `${JSON.stringify(submissions, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryFile, submissionsFile);
  });

  saveQueue = write.catch(() => {});
  return write;
}

async function handleContactRequest(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { error: 'Use POST to submit contact details.' });
    return;
  }

  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    sendJson(response, 415, { error: 'Content-Type must be application/json.' });
    return;
  }

  if (!checkRateLimit(request)) {
    sendJson(response, 429, { error: 'Too many submissions. Please try again later.' });
    return;
  }

  try {
    const payload = await readRequestBody(request);
    const validation = validateSubmission(payload);
    if (validation.error) {
      sendJson(response, 400, { error: validation.error });
      return;
    }

    await saveSubmission(validation.submission);
    sendJson(response, 201, { success: true, message: 'Your details were saved successfully.' });
  } catch (error) {
    if (error.statusCode) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }

    console.error('Could not save contact submission:', error);
    sendJson(response, 500, { error: 'The server could not save your details. Please try again later.' });
  }
}

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.svg', 'image/svg+xml'],
]);

async function serveBuiltFile(request, response) {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end('Invalid URL.');
    return;
  }

  const isResume = decodedPath === '/ARUN_K_Resume_Updated.pdf';
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const distDirectory = path.resolve(root, 'dist');
  const filePath = isResume
    ? path.join(root, 'ARUN_K_Resume_Updated.pdf')
    : path.resolve(distDirectory, relativePath);
  const relativeToDist = path.relative(distDirectory, filePath);
  if (!isResume && (relativeToDist.startsWith('..') || path.isAbsolute(relativeToDist))) {
    response.writeHead(404).end('Not found.');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      response.writeHead(404).end('Not found.');
      return;
    }

    response.writeHead(200, {
      'Content-Type': contentTypes.get(path.extname(filePath)) ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    response.writeHead(404).end('Not found.');
  }
}

let vite = null;
const server = createHttpServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/api/contact') {
    await handleContactRequest(request, response);
    return;
  }
  if (pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'API route not found.' });
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed.');
    return;
  }

  if (vite) {
    vite.middlewares(request, response, (error) => {
      if (error) {
        console.error('Development server error:', error);
        if (!response.headersSent) {
          response.writeHead(500).end('Development server error.');
        }
      } else if (!response.writableEnded) {
        response.writeHead(404).end('Not found.');
      }
    });
    return;
  }

  try {
    await serveBuiltFile(request, response);
  } catch (error) {
    console.error('Could not serve built file:', error);
    if (!response.headersSent) {
      response.writeHead(500).end('Unable to serve this page.');
    }
  }
});

if (!production) {
  vite = await createViteServer({
    appType: 'spa',
    server: { hmr: { server }, middlewareMode: true },
  });
}

await mkdir(dataDirectory, { recursive: true });

let port = Number(process.env.PORT) || 5173;
const host = process.env.HOST || '127.0.0.1';
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && port < (Number(process.env.PORT) || 5183)) {
    port += 1;
    server.listen(port, host);
    return;
  }

  console.error('Could not start the portfolio server:', error);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  const address = server.address();
  console.log(`Portfolio server listening at http://${host}:${address.port}`);
  console.log(`Contact submissions will be stored in ${submissionsFile}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    if (vite) {
      await vite.close();
    }
    process.exit(0);
  });
}
