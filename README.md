# E-Commerce Price Tracker 

A lightweight Node.js backend that concurrently searches multiple e-commerce websites to find the best prices for products.
This service acts as the core engine for a browser extension. It manages headless browser scraping, parses web pages to find prices, and runs a background system for real-time price drop emails.


## Features
* **Multi-Site Scraping:** Uses Puppeteer to search multiple retailers simultaneously for faster results.
* **Smart Data Extraction:**  Employs fallback CSS selectors to accurately find prices even when website layouts change or feature different deal formats.
* **Automated Price Alerts:** Includes a background job that regularly checks your watched products and sends an email notification via Nodemailer when your target price is reached.
* **Browser Extension Ready:** Designed to communicate directly with a React-based Chrome extension using Express and CORS.

## Tech Stack
* **Node.js & Express.js:** Server and API routing.
* **Puppeteer:** Headless browser automation for web scraping.
* **Nodemailer:** Automated email delivery for price alerts.

## 📦 Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd price-tracker-api
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:** To enable email alerts, create a `.env` file in the root folder with your SMTP details (such as a Gmail App Password):
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your_email@gmail.com
   SMTP_PASS=your_app_password
   SMTP_SECURE=false
   ```

4. **Start the server:**
   ```bash
   node server.js
   ```
   
   *The server runs on* `http://localhost:3001`.

## 🔌 API Endpoints

### 1. Compare Prices

* **Endpoint:** `GET /api/compare`
* **Description:** Searches for a product across configured retailers and returns a list of prices.
* **Example Request:** `http://localhost:3001/api/compare?q=iPhone 15`

### 2. Set Price Alert

* **Endpoint:** `POST /api/alert`
* **Description:** Registers a product to be monitored. When the price drops to or below the `desiredPrice`, an email is sent.
