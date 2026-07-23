const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { searchProductPrice } = require('./scraper');

const app = express();
const PORT = 3000;
const ALERTS_FILE = path.join(__dirname, 'alerts.json');
const ALERT_EMAIL = 'djshah2710@gmail.com';

// Enable CORS so your Chrome extension can make requests to this server
app.use(cors());
// Parse incoming JSON requests
app.use(express.json());

function loadAlerts() {
  try {
    if (!fs.existsSync(ALERTS_FILE)) {
      fs.writeFileSync(ALERTS_FILE, JSON.stringify([]));
      return [];
    }
    const raw = fs.readFileSync(ALERTS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('Failed to load alerts:', error);
    return [];
  }
}

function saveAlerts(alerts) {
  try {
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
  } catch (error) {
    console.error('Failed to save alerts:', error);
  }
}

function parsePrice(priceString) {
  if (!priceString) return NaN;
  const digits = priceString.toString().replace(/[^\d.]/g, '');
  return Number(digits);
}

function getLowestResult(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  return results.reduce((lowest, item) => {
    const value = parsePrice(item.price);
    if (!Number.isFinite(value)) return lowest;
    if (!lowest || value < lowest.priceValue) {
      return { ...item, priceValue: value };
    }
    return lowest;
  }, null);
}

function getEmailTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === 'true';

  if (!host || !user || !pass) {
    console.warn('SMTP environment variables are not configured. Email alerts will not be sent.');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

async function sendAlertEmail(alert, matchedResult) {
  const transporter = getEmailTransporter();
  if (!transporter) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS.');
  }

  const subject = `Price Alert: "${alert.productTitle}" is now ${matchedResult.price}`;
  const text = `Good news! The product you requested to watch has dropped to your target price.\n\n` +
    `Product: ${alert.productTitle}\n` +
    `Target price: ₹${alert.desiredPrice}\n` +
    `Current price: ${matchedResult.price}\n` +
    `Store: ${matchedResult.store}\n` +
    `Link: ${matchedResult.url}\n\n` +
    `This alert was registered with the Price Tracker service.`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: ALERT_EMAIL,
    subject,
    text
  });
}

async function checkAlerts() {
  const alerts = loadAlerts();
  let changed = false;

  for (const alert of alerts) {
    if (alert.sent) continue;

    try {
      const results = await searchProductPrice(alert.productTitle);
      const lowest = getLowestResult(results);
      alert.lastCheckedAt = new Date().toISOString();

      if (lowest && lowest.priceValue <= alert.desiredPrice) {
        await sendAlertEmail(alert, lowest);
        alert.sent = true;
        alert.sentAt = new Date().toISOString();
        alert.matchedStore = lowest.store;
        alert.matchedPrice = lowest.price;
        console.log(`📧 Price alert sent for ${alert.productTitle} at ${lowest.price} (${lowest.store})`);
      }

      changed = true;
    } catch (error) {
      console.error(`Failed to check alert for ${alert.productTitle}:`, error?.message || error);
    }
  }

  if (changed) {
    saveAlerts(alerts);
  }
}

async function startAlertMonitor() {
  try {
    await checkAlerts();
  } catch (error) {
    console.error('Error during initial alert check:', error);
  }
  setInterval(() => {
    checkAlerts().catch((err) => console.error('Scheduled alert check failed:', err));
  }, 1000 * 60 * 15);
}

// The API endpoint your extension will call
app.get('/api/search', async (req, res) => {
  const productTitle = req.query.q;

  if (!productTitle) {
    return res.status(400).json({ error: "Missing product query 'q'" });
  }

  console.log(`\n🔍 Extension requested search for: "${productTitle}"`);

  try {
    // Call the scraper function
    const result = await searchProductPrice(productTitle);
    
    // Send the result back to the extension
    res.json(result);
  } catch (error) {
    console.error("Search failed:", error);
    res.status(500).json({ error: "Failed to scrape pricing data." });
  }
});

app.post('/api/alert', async (req, res) => {
  const { productTitle, desiredPrice } = req.body;
  const numericPrice = Number(desiredPrice);

  if (!productTitle || desiredPrice === undefined) {
    return res.status(400).json({ error: "Missing required fields: productTitle and desiredPrice." });
  }

  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    return res.status(400).json({ error: "desiredPrice must be a positive number." });
  }

  const alerts = loadAlerts();
  const existing = alerts.find((alert) =>
    alert.productTitle.trim().toLowerCase() === productTitle.trim().toLowerCase() &&
    alert.desiredPrice === numericPrice &&
    !alert.sent
  );

  if (existing) {
    return res.status(200).json({ message: `An alert is already registered for ₹${numericPrice}.` });
  }

  const newAlert = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    productTitle: productTitle.trim(),
    desiredPrice: numericPrice,
    email: ALERT_EMAIL,
    createdAt: new Date().toISOString(),
    sent: false,
    lastCheckedAt: null
  };

  alerts.push(newAlert);
  saveAlerts(alerts);

  try {
    const results = await searchProductPrice(newAlert.productTitle);
    const lowest = getLowestResult(results);

    if (lowest && lowest.priceValue <= newAlert.desiredPrice) {
      await sendAlertEmail(newAlert, lowest);
      newAlert.sent = true;
      newAlert.sentAt = new Date().toISOString();
      newAlert.matchedStore = lowest.store;
      newAlert.matchedPrice = lowest.price;
      saveAlerts(alerts);
      return res.json({ message: `Alert triggered and email sent to ${ALERT_EMAIL}.`, alert: newAlert });
    }
  } catch (error) {
    console.error('Error checking current price for alert:', error);
  }

  res.json({ message: `Alert saved. We will email ${ALERT_EMAIL} when the price reaches ₹${numericPrice}.`, alert: newAlert });
});

// The /api/compare endpoint that your extension is calling
app.get('/api/compare', async (req, res) => {
  const productTitle = req.query.q;

  if (!productTitle) {
    return res.status(400).json({ error: "Missing product query 'q'" });
  }

  console.log(`\n🔍 Compare request for: "${productTitle}"`);

  try {
    // Call the scraper function to get results from multiple stores
    const results = await searchProductPrice(productTitle);
    
    // Send the results back to the extension
    res.json(results);
  } catch (error) {
    console.error("Compare failed:", error);
    res.status(500).json({ error: "Failed to scrape pricing data." });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend API running on http://localhost:${PORT}`);
  startAlertMonitor();
});