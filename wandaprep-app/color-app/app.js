const express = require('express');
const winston = require('winston');
const WinstonCloudWatch = require('winston-cloudwatch');

const app  = express();
const PORT = process.env.PORT || 8080;

// ── Values injected by Kubernetes ConfigMap and Secret ───────────────────────
const APP_COLOR   = process.env.APP_COLOR   || 'red';
const APP_ENV     = process.env.APP_ENV     || 'development';
const APP_MESSAGE = process.env.APP_MESSAGE || 'Hello from wandaprep-app!';
const SECRET_KEY  = process.env.SECRET_KEY  || 'not-set';
const LOG_LEVEL   = process.env.LOG_LEVEL   || 'info';
const AWS_REGION  = process.env.AWS_REGION  || 'us-east-1';
const LOG_GROUP   = process.env.LOG_GROUP   || '/wandaprep-app';
const LOG_STREAM  = process.env.LOG_STREAM  || `${APP_ENV}/${process.env.HOSTNAME || 'local'}`;

// ── Logger ───────────────────────────────────────────────────────────────────
const transports = [
  // Always log structured JSON to stdout — captured by kubectl logs and Fluent Bit
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  })
];

// Send to CloudWatch only when AWS credentials or IRSA are available
if (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_WEB_IDENTITY_TOKEN_FILE) {
  transports.push(
    new WinstonCloudWatch({
      logGroupName:  LOG_GROUP,
      logStreamName: LOG_STREAM,
      awsRegion:     AWS_REGION,
      messageFormatter: ({ level, message, ...meta }) =>
        JSON.stringify({ level, message, ...meta }),
      retentionInDays: 14
    })
  );
}

const logger = winston.createLogger({
  level: LOG_LEVEL,
  transports
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('http_request', {
      method:     req.method,
      path:       req.path,
      status:     res.statusCode,
      duration_ms: Date.now() - start,
      ip:         req.ip
    });
  });
  next();
});

// ── Routes ───────────────────────────────────────────────────────────────────

// Main page — renders color, env, message and secret from ConfigMap + Secret
app.get('/', (req, res) => {
  const fs   = require('fs');
  const path = require('path');
  fs.readFile(path.join(__dirname, 'index.html'), 'utf8', (err, data) => {
    if (err) {
      logger.error('template_read_error', { error: err.message });
      return res.status(500).send('Internal Server Error');
    }
    res.send(
      data
        .replace(/{{APP_COLOR}}/g,   APP_COLOR)
        .replace(/{{APP_ENV}}/g,     APP_ENV)
        .replace(/{{APP_MESSAGE}}/g, APP_MESSAGE)
        .replace(/{{SECRET_KEY}}/g,  SECRET_KEY)
    );
  });
});

// Health check — used by Kubernetes liveness and readiness probes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Config dump — shows all injected ConfigMap values (no secrets)
// Useful in class to prove ConfigMap injection is working
app.get('/config', (req, res) => {
  res.json({
    APP_COLOR,
    APP_ENV,
    APP_MESSAGE,
    LOG_LEVEL,
    AWS_REGION,
    LOG_GROUP,
    LOG_STREAM,
    note: 'SECRET_KEY is intentionally omitted from this endpoint'
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info('app_started', {
    port:        PORT,
    environment: APP_ENV,
    color:       APP_COLOR,
    message:     APP_MESSAGE,
    log_group:   LOG_GROUP,
    log_stream:  LOG_STREAM,
    sources: {
      APP_COLOR:   'ConfigMap → wandaprep-config',
      APP_ENV:     'ConfigMap → wandaprep-config',
      APP_MESSAGE: 'ConfigMap → wandaprep-config',
      SECRET_KEY:  'Secret    → wandaprep-secret'
    }
  });
});
