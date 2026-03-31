import express from 'express';
import session from 'express-session';
import engine from 'ejs-mate';
import path from 'path';
import { fileURLToPath } from 'url';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import crypto from 'crypto';
import config from './config.js';
import requestId from './src/interface/http/middleware/requestId.js';
import { apiLimiter, loginLimiter } from './src/interface/http/middleware/rateLimiter.js';
import health from './src/interface/http/routes/health.js';
import dora from './src/interface/http/routes/dora.js';
import logger from './src/infrastructure/logging/Logger.js';

import init_db from './model/init_db.js';
import login from './routes/login.js';
import products from './routes/products.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Template engine - ejs-mate replaces ejs-locals (compatible with ejs 3.x)
app.engine('ejs', engine);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Request ID tracking
app.use(requestId);

// Middleware
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));

// Secure session configuration
app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.COOKIE_SECURE === 'true',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict'
  },
  name: 'sessionId'
}));

// CSRF protection (synchronizer token pattern, session-based — replaces deprecated csurf)
app.use(function(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  req.csrfToken = () => req.session.csrfToken;
  res.locals.csrfToken = req.session.csrfToken;

  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (!safeMethods.includes(req.method)) {
    const submitted = req.body?._csrf || req.headers['x-csrf-token'];
    if (submitted !== req.session.csrfToken) {
      const err = new Error('Invalid CSRF token');
      err.code = 'EBADCSRFTOKEN';
      return next(err);
    }
  }
  next();
});

// Rate limiting
app.use('/login/auth', loginLimiter);
app.use(apiLimiter);

// Health check (no auth required)
app.use('', health);

// DORA Metrics dashboard (no auth required)
app.use('', dora);

// Routes (login must be before products to avoid redirect loop from auth middleware)
app.use('', login);
app.use('', products);

// CSRF error handler
app.use(function(err, req, res, next) {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ message: 'Invalid CSRF token' });
  }
  next(err);
});

// 404 handler
app.use(function(req, res, next) {
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// Development error handler
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// Production error handler
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});

// Initialize database
logger.info("Building database...");
init_db();

export default app;
