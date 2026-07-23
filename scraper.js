const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

// Ensure debug directory exists
const debugDir = path.join(__dirname, "debug");
if (!fs.existsSync(debugDir)) {
  fs.mkdirSync(debugDir, { recursive: true });
}

/**
 * Utility to save page HTML for debugging
 */
async function savePageHTML(page, filename) {
  try {
    const html = await page.content();
    const filePath = path.join(debugDir, filename);
    fs.writeFileSync(filePath, html);
    console.log(`📄 Page HTML saved to: ${filePath}`);
  } catch (err) {
    console.error(`Failed to save HTML: ${err.message}`);
  }
}

/**
 * Try to set pincode on quick-commerce sites (modal or inline inputs).
 */
async function setPincode(page, pincode) {
  const trySelectors = [
    "input[name*='pincode']",
    "input[id*='pincode']",
    "input[class*='pincode']",
    "input[placeholder*='pincode']",
    "input[placeholder*='Pin']",
    "input[placeholder*='PIN']",
    "input[placeholder*='Enter pincode']",
    "input[type='tel']",
    "input[type='number']",
    "input"
  ];

  const confirmWords = ['apply', 'check', 'save', 'set', 'ok', 'submit', 'go', 'confirm'];

  // First try targeted selectors
  for (const sel of trySelectors) {
    try {
      const el = await page.$(sel);
      if (!el) continue;

      await el.click({ clickCount: 3 }).catch(() => {});
      await el.focus().catch(() => {});
      await page.evaluate((s, v) => {
        const node = document.querySelector(s);
        if (!node) return;
        node.value = v;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, sel, pincode);

      // Try pressing Enter to submit
      try { await page.keyboard.press('Enter'); } catch (e) {}

      // Try clicking confirm buttons if present
      for (const word of confirmWords) {
        try {
          const btns = await page.$x(`//button[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${word}')]`);
          if (btns && btns.length) {
            await btns[0].click().catch(() => {});
          }
        } catch (e) {}
      }

      await page.waitForTimeout(1000);
      return true;
    } catch (e) {
      // ignore and continue
    }
  }

  // Fallback: try to set any input whose placeholder/aria-label/text nearby mentions pin/pincode
  try {
    const success = await page.evaluate((v) => {
      const inputs = Array.from(document.querySelectorAll('input'));
      for (const input of inputs) {
        const ph = (input.placeholder || '') + ' ' + (input.getAttribute('aria-label') || '') + ' ' + (input.name || '') + ' ' + (input.id || '');
        if (ph.toLowerCase().includes('pin') || ph.toLowerCase().includes('pincode') || ph.toLowerCase().includes('pin code')) {
          input.value = v;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, pincode);

    if (success) {
      await page.keyboard.press('Enter').catch(() => {});
      await page.waitForTimeout(800);
      return true;
    }
  } catch (e) {
    // ignore
  }

  return false;
}

/**
 * Amazon India Scraper
 */
async function scrapeAmazon(query, browser) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    );
    const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(query)}`;
    console.log(`🔗 Searching Amazon: ${searchUrl}`);
    
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for JS to render
    
    // Save HTML for debugging
    await savePageHTML(page, `amazon_${Date.now()}.html`);

    const result = await page.evaluate(() => {
      const containers = document.querySelectorAll(
        "[data-component-type='s-search-result'], [data-component-type='s-result-item'], div.s-result-item, div[data-index]"
      );
      
      console.log(`Found ${containers.length} containers on Amazon`);
      
      if (containers.length === 0) {
        return null;
      }

      for (let firstProduct of containers) {
        let titleEl = firstProduct.querySelector("h2 a span");
        if (!titleEl) titleEl = firstProduct.querySelector("h2 span");
        if (!titleEl) titleEl = firstProduct.querySelector("h2 a");
        if (!titleEl) titleEl = firstProduct.querySelector("h2");
        if (!titleEl) titleEl = firstProduct.querySelector("a.a-link-normal span");
        if (!titleEl) titleEl = firstProduct.querySelector("a.a-link-normal");
        
        if (!titleEl) continue;

        const title = (titleEl.innerText || titleEl.textContent || "").trim();
        if (!title || title.length < 5) continue;

        let priceEl = firstProduct.querySelector(".a-price .a-offscreen");
        if (!priceEl) priceEl = firstProduct.querySelector(".a-price-whole");
        if (!priceEl) priceEl = firstProduct.querySelector(".a-price");
        if (!priceEl) {
          const allSpans = firstProduct.querySelectorAll("span");
          for (let span of allSpans) {
            if (span.textContent?.includes("₹")) {
              priceEl = span;
              break;
            }
          }
        }
        
        if (!priceEl) continue;

        const price = (priceEl.innerText || priceEl.textContent || "").trim();
        if (!price || !price.includes("₹")) continue;

        const linkEl = firstProduct.querySelector("h2 a") || firstProduct.querySelector("a.a-link-normal");
        let href = linkEl ? linkEl.getAttribute("href") : "";

        if (href && href.startsWith("/")) {
          href = `https://www.amazon.in${href}`;
        }

        console.log(`✅ Amazon found: ${title.substring(0, 50)}`);
        return {
          title: title,
          price: price,
          url: href || searchUrl
        };
      }

      return null;
    });

    return result ? { store: "Amazon.in", ...result } : null;
  } catch (err) {
    console.error("❌ Amazon scrape error:", err.message);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Flipkart Scraper
 */
async function scrapeFlipkart(query, browser) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    );
    const searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;
    console.log(`🔗 Searching Flipkart: ${searchUrl}`);
    
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

    try {
      const closeButton = await page.waitForSelector("button._2KpZ6l._2doB4z", { timeout: 5000 });
      if (closeButton) {
        await closeButton.click();
        console.log("✖️ Closed Flipkart login popup");
      }
    } catch (e) {
      // no modal appeared, continue normally
    }

    try {
      await page.waitForSelector("div._1AtVbE, div._13oc-S, div._1YokD2, div._2kHMtP, a.s1Q9rs, a.IRpwTa", { timeout: 10000 }).catch(() => {});
    } catch (e) {
      console.warn("⚠️ Flipkart product selector not found");
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000)); // Additional wait for JS to fully render

    // Save HTML for debugging
    await savePageHTML(page, `flipkart_${Date.now()}.html`);

    const result = await page.evaluate(() => {
      const priceSelectors = ["div._30jeq3", "div._3I9_wc", "div._1_WHN1", "span._24_Dny", "div._25b18c"];

      function findPrice(container) {
        for (const sel of priceSelectors) {
          const el = container.querySelector(sel);
          if (el && el.innerText && el.innerText.includes("₹")) return el;
        }
        const allEls = container.querySelectorAll("span, div");
        for (const el of allEls) {
          const text = (el.innerText || el.textContent || "").trim();
          if (text.match(/₹\s*[\d,]+/)) return el;
        }
        return null;
      }

      const titleSelectors = ["div._4rR01T", "a.s1Q9rs", "a.IRpwTa", "div._2WkVRV"];
      const cardSet = new Set();
      const candidates = [];

      for (const sel of titleSelectors) {
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els) {
          const card = el.closest("div");
          if (card && !cardSet.has(card)) {
            cardSet.add(card);
            candidates.push(card);
          }
        }
      }

      if (candidates.length === 0) {
        const fallback = Array.from(document.querySelectorAll("div._1AtVbE, div._13oc-S, div._2kHMtP"));
        fallback.forEach((card) => {
          if (!cardSet.has(card)) {
            cardSet.add(card);
            candidates.push(card);
          }
        });
      }

      for (const card of candidates) {
        let titleEl = null;
        for (const sel of titleSelectors) {
          titleEl = card.querySelector(sel);
          if (titleEl) break;
        }
        if (!titleEl) continue;

        const title = (titleEl.innerText || titleEl.textContent || "").trim();
        if (!title || title.length < 5) continue;

        const priceEl = findPrice(card);
        if (!priceEl) continue;

        const price = (priceEl.innerText || priceEl.textContent || "").trim();
        if (!price || !price.includes("₹")) continue;

        let linkEl = card.querySelector("a._1fQZEK, a.s1Q9rs, a.IRpwTa, a[href*='/p/']");
        if (!linkEl) linkEl = card.querySelector("a");

        let href = linkEl ? linkEl.getAttribute("href") : "";
        if (href && href.startsWith("/")) {
          href = `https://www.flipkart.com${href}`;
        }

        console.log(`✅ Flipkart found: ${title.substring(0, 50)}`);
        return {
          title: title,
          price: price,
          url: href || "https://www.flipkart.com"
        };
      }

      return null;
    });

    return result ? { store: "Flipkart", ...result } : null;
  } catch (err) {
    console.error("❌ Flipkart scrape error:", err.message);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Vijay Sales Scraper
 */
async function scrapeVijaySales(query, browser) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    );
    const searchUrl = `https://www.vijaysales.com/search-listing?q=${encodeURIComponent(query)}`;
    console.log(`🔗 Searching Vijay Sales: ${searchUrl}`);
    
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for JS to render

    // Save HTML for debugging
    await savePageHTML(page, `vijaysales_${Date.now()}.html`);

    const result = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href*='/p/']"));

      function cleanTitle(text) {
        return text
          .replace(/\s*₹[\d,]+.*$/, "")
          .replace(/(Exchange Bonus|Notify Me|Wishlist|Shopping Cart|Out Of Stock|product deals|Extra Deals Available|Same Day Shipping).*$/i, "")
          .trim();
      }

      for (const linkEl of links) {
        const href = (linkEl.getAttribute("href") || "").trim();
        if (!href || !href.includes("/p/")) continue;

        const text = (linkEl.innerText || linkEl.textContent || "").trim();
        if (!text || text.length < 10) continue;

        const priceMatch = text.match(/₹\s*[\d,]+/);
        if (!priceMatch) continue;

        const price = priceMatch[0].trim();
        const title = cleanTitle(text.split(price)[0] || text);
        if (!title || title.length < 5) continue;

        let hrefFull = href;
        if (hrefFull.startsWith("/")) {
          hrefFull = `https://www.vijaysales.com${hrefFull}`;
        }

        console.log(`✅ Vijay Sales found: ${title.substring(0, 50)}`);
        return {
          title: title,
          price: price,
          url: hrefFull
        };
      }

      return null;
    });

    return result ? { store: "Vijay Sales", ...result } : null;
  } catch (err) {
    console.error("❌ Vijay Sales scrape error:", err.message);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Zepto Scraper (Quick Commerce)
 */
async function scrapeZepto(query, browser) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    );
    
    const searchUrl = `https://www.zepto.com/`;
    console.log(`🔗 Searching Zepto: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

    // Try to set pincode so location-specific popups don't block content
    try {
      const ok = await setPincode(page, '400067');
      if (ok) {
        console.log('📍 Zepto pincode set to 400067');
        await savePageHTML(page, `zepto_pin_set_${Date.now()}.html`);
      }
    } catch (e) {}

    const result = await page.evaluate(() => {
      let card = document.querySelector("[class*='ProductCard']");
      if (!card) card = document.querySelector("[class*='product']");
      if (!card) card = document.querySelector("div[role='button']");
      
      if (!card) return null;

      let titleEl = card.querySelector("h2") || card.querySelector("[class*='title']") || card.querySelector("span");
      let priceEl = card.querySelector("[class*='price']") || card.querySelector("[class*='Price']");
      const linkEl = card.querySelector("a");

      if (!priceEl || !titleEl) return null;

      let href = linkEl ? linkEl.getAttribute("href") : "";
      if (href && href.startsWith("/")) {
        href = `https://www.zepto.com${href}`;
      }

      console.log(`✅ Zepto found`);
      return {
        title: titleEl.innerText?.trim() || "",
        price: priceEl.innerText?.trim() || "",
        url: href || "https://www.zepto.com"
      };
    });

    return result ? { store: "Zepto", ...result } : null;
  } catch (err) {
    console.error("❌ Zepto scrape error:", err.message);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Blinkit Scraper (Quick Commerce)
 */
async function scrapeBlinkit(query, browser) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    );
    
    const searchUrl = `https://www.blinkit.com/`;
    console.log(`🔗 Searching Blinkit: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

    // Try to set pincode to bypass location modal
    try {
      const ok = await setPincode(page, '400067');
      if (ok) {
        console.log('📍 Blinkit pincode set to 400067');
        await savePageHTML(page, `blinkit_pin_set_${Date.now()}.html`);
      }
    } catch (e) {}

    const result = await page.evaluate(() => {
      let card = document.querySelector("[class*='ProductCard']");
      if (!card) card = document.querySelector("[class*='product']");
      if (!card) card = document.querySelector("div[role='button']");
      
      if (!card) return null;

      let titleEl = card.querySelector("h2") || card.querySelector("[class*='title']") || card.querySelector("span");
      let priceEl = card.querySelector("[class*='price']") || card.querySelector("[class*='Price']");
      const linkEl = card.querySelector("a");

      if (!priceEl || !titleEl) return null;

      let href = linkEl ? linkEl.getAttribute("href") : "";
      if (href && href.startsWith("/")) {
        href = `https://www.blinkit.com${href}`;
      }

      console.log(`✅ Blinkit found`);
      return {
        title: titleEl.innerText?.trim() || "",
        price: priceEl.innerText?.trim() || "",
        url: href || "https://www.blinkit.com"
      };
    });

    return result ? { store: "Blinkit", ...result } : null;
  } catch (err) {
    console.error("❌ Blinkit scrape error:", err.message);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Instamart Scraper (Quick Commerce)
 */
async function scrapeInstamart(query, browser) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    );
    
    const searchUrl = `https://www.instamart.in/`;
    console.log(`🔗 Searching Instamart: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

    // Try to set pincode so product lists are visible
    try {
      const ok = await setPincode(page, '400067');
      if (ok) {
        console.log('📍 Instamart pincode set to 400067');
        await savePageHTML(page, `instamart_pin_set_${Date.now()}.html`);
      }
    } catch (e) {}

    const result = await page.evaluate(() => {
      let card = document.querySelector("[class*='ProductCard']");
      if (!card) card = document.querySelector("[class*='product']");
      if (!card) card = document.querySelector("div[role='button']");
      
      if (!card) return null;

      let titleEl = card.querySelector("h2") || card.querySelector("[class*='title']") || card.querySelector("span");
      let priceEl = card.querySelector("[class*='price']") || card.querySelector("[class*='Price']");
      const linkEl = card.querySelector("a");

      if (!priceEl || !titleEl) return null;

      let href = linkEl ? linkEl.getAttribute("href") : "";
      if (href && href.startsWith("/")) {
        href = `https://www.instamart.in${href}`;
      }

      console.log(`✅ Instamart found`);
      return {
        title: titleEl.innerText?.trim() || "",
        price: priceEl.innerText?.trim() || "",
        url: href || "https://www.instamart.in"
      };
    });

    return result ? { store: "Instamart", ...result } : null;
  } catch (err) {
    console.error("❌ Instamart scrape error:", err.message);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Reliance Digital Scraper
 */
async function scrapeRelianceDigital(query, browser) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    );
    const searchUrl = `https://www.reliancedigital.in/search?q=${encodeURIComponent(query)}`;
    console.log(`🔗 Searching Reliance Digital: ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    await page.waitForSelector("a[data-test='product-card'], div.card-product, .product-item, .product-card, .product-tile", { timeout: 10000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await savePageHTML(page, `reliancedigital_${Date.now()}.html`);

    const result = await page.evaluate(() => {
      const productCards = Array.from(document.querySelectorAll("a[data-test='product-card'], div.card-product, .product-item, .product-card, .product-tile"));
      const fallbackCards = Array.from(document.querySelectorAll(".product-item, .product-card, .product-tile"));
      const cards = productCards.length > 0 ? productCards : fallbackCards;

      function cleanText(text) {
        return (text || "").trim().replace(/\s+/g, " ");
      }

      for (const card of cards) {
        const titleEl = card.querySelector(".card-title, .product-title, .product-name, h2, h3");
        const priceEl = card.querySelector(".price, .product-final-price, .product-price, .offer-price, .price-value");
        const linkEl = card.closest("a") || card.querySelector("a");

        if (!titleEl || !priceEl) continue;

        const title = cleanText(titleEl.innerText || titleEl.textContent || "");
        const price = cleanText(priceEl.innerText || priceEl.textContent || "");
        if (!title || !price || !price.includes("₹")) continue;

        let href = linkEl ? linkEl.getAttribute("href") : "";
        if (href && href.startsWith("/")) href = `https://www.reliancedigital.in${href}`;

        return {
          title,
          price,
          url: href || searchUrl
        };
      }

      return null;
    });

    return result ? { store: "Reliance Digital", ...result } : null;
  } catch (err) {
    console.error("❌ Reliance Digital scrape error:", err.message);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Main Orchestrator
 */
async function scrapeAll(query) {
  console.log(`\n📦 Starting price comparison for: "${query}"\n`);
  
  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, "-");
  const debugFileName = `search_${timestamp}_${query.substring(0, 30).replace(/[^a-z0-9]/gi, "_")}.json`;
  const debugFilePath = path.join(debugDir, debugFileName);
  
  const debugData = {
    query: query,
    startTime: startTime.toISOString(),
    results: [],
    errors: []
  };
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const results = await Promise.allSettled([
      scrapeAmazon(query, browser),
      scrapeFlipkart(query, browser),
      scrapeVijaySales(query, browser),
      scrapeRelianceDigital(query, browser),
      scrapeZepto(query, browser),
      scrapeBlinkit(query, browser),
      scrapeInstamart(query, browser)
    ]);

    const validResults = results
      .filter((r) => r.status === "fulfilled" && r.value !== null)
      .map((r) => r.value);
    
    debugData.results = validResults;
    
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        debugData.errors.push({
          store: ["Amazon", "Flipkart", "Vijay Sales", "Reliance Digital", "Zepto", "Blinkit", "Instamart"][index],
          error: result.reason.message
        });
      }
    });
    
    console.log(`\n✅ Total results found: ${validResults.length}\n`);
    
    if (validResults.length === 0) {
      console.warn("⚠️  No products found on any platform.");
    }
    
    debugData.endTime = new Date().toISOString();
    debugData.duration = new Date(debugData.endTime) - startTime;
    
    fs.writeFileSync(debugFilePath, JSON.stringify(debugData, null, 2));
    console.log(`💾 Debug log saved to: ${debugFilePath}\n`);
    
    return validResults;
  } finally {
    await browser.close();
  }
}

const searchProductPrice = scrapeAll;

module.exports = { scrapeAll, searchProductPrice };
