const express = require('express');
const cors = require('cors');
const { searchProductPrice } = require('./scraper'); // We will build this next

const app = express();
const PORT = 3000;

// Enable CORS so your Chrome extension can make requests to this server
app.use(cors());
// Parse incoming JSON requests
app.use(express.json());

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
});