import { useState } from "react";

interface ScrapedResult {
  store: string;
  title: string;
  price: string;
  url: string;
}

const DEFAULT_BACKEND_URL = process.env.PLASMO_PUBLIC_BACKEND_URL || "http://localhost:3000";

export default function IndexPopup() {
  const [productTitle, setProductTitle] = useState<string>("");
  const [results, setResults] = useState<ScrapedResult[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [alertLoading, setAlertLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [notifyStatus, setNotifyStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [desiredPrice, setDesiredPrice] = useState<string>("");
  const [backendUrl, setBackendUrl] = useState<string>(DEFAULT_BACKEND_URL);

  const handleScanAndCompare = async () => {
    setLoading(true);
    setError("");
    setResults([]);

    try {
      let titleToSearch = "";

      if (typeof chrome !== "undefined" && chrome.tabs) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          const response = await chrome.tabs.sendMessage(tab.id, { action: "EXTRACT_PRODUCT_INFO" }).catch(() => null);
          titleToSearch = response?.title || tab.title || "";
        }
      }

      if (!titleToSearch) {
        throw new Error("Could not detect product title from the active page.");
      }

      // Remove common platform prefixes and clean the title
      let cleanTitle = titleToSearch
        .replace(/^(amazon\.com|flipkart|vijay\s*sales|ebay|walmart|myntra):\s*/i, "")
        .split(/[,|\-:()]/)[0]
        .trim();
      
      // Remove common suffixes and extra info
      cleanTitle = cleanTitle.split(/[\|\-]/)[0].trim();
      
      setProductTitle(cleanTitle);

      const normalizedBaseUrl = (backendUrl || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, "");
      const compareUrl = `${normalizedBaseUrl}/api/compare?q=${encodeURIComponent(cleanTitle)}`;

      const res = await fetch(compareUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        mode: "cors"
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(body ? `Backend returned ${res.status}: ${body}` : `Backend returned ${res.status}`);
      }

      const data: ScrapedResult[] = await res.json();
      if (!data || data.length === 0) {
        setError("No matching products found on other platforms.");
      } else {
        setResults(data);
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  // Helper function to safely open external links in a new browser tab
  const handleSetPriceAlert = async () => {
    setError("");
    setNotifyStatus(null);

    if (!productTitle) {
      setError("No product was detected to set an alert.");
      return;
    }

    const parsedPrice = Number(desiredPrice.replace(/[^0-9.]/g, ""));
    if (!desiredPrice || Number.isNaN(parsedPrice) || parsedPrice <= 0) {
      setError("Enter a valid target price to receive an alert.");
      return;
    }

    setAlertLoading(true);
    try {
      const normalizedBaseUrl = (backendUrl || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, "");
      const response = await fetch(`${normalizedBaseUrl}/api/alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productTitle, desiredPrice: parsedPrice })
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error || `Backend returned ${response.status}`);
      }

      setNotifyStatus({
        type: "success",
        message: `Alert set for ₹${parsedPrice.toLocaleString()}. You will receive an email at djshah2710@gmail.com when the price is reached.`
      });
      setDesiredPrice("");
    } catch (err: any) {
      setNotifyStatus({
        type: "error",
        message: err?.message || "Unable to register the price alert."
      });
    } finally {
      setAlertLoading(false);
    }
  };

  const openExternalLink = (url: string) => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div style={{ width: "340px", padding: "16px", fontFamily: "Segoe UI, sans-serif" }}>
      <h2 style={{ margin: "0 0 8px 0", fontSize: "18px", color: "#111827" }}>Price Comparator</h2>
      <p style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#6B7280" }}>
        Scan current page & find prices across stores.
      </p>

      <button
        onClick={handleScanAndCompare}
        disabled={loading}
        style={{
          width: "100%",
          padding: "10px",
          backgroundColor: loading ? "#9CA3AF" : "#2563EB",
          color: "#FFFFFF",
          border: "none",
          borderRadius: "6px",
          fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer"
        }}>
        {loading ? "Searching Stores..." : "Compare Price"}
      </button>

      <div style={{ marginTop: "10px" }}>
        <label style={{ fontSize: "12px", color: "#374151", display: "block", marginBottom: "4px" }}>
          Backend URL
        </label>
        <input
          value={backendUrl}
          onChange={(event) => setBackendUrl(event.target.value)}
          placeholder="http://localhost:3000"
          style={{
            width: "100%",
            padding: "8px",
            border: "1px solid #D1D5DB",
            borderRadius: "6px",
            fontSize: "12px"
          }}
        />
      </div>

      {productTitle && (
        <div style={{ marginTop: "12px" }}>
          <strong style={{ fontSize: "12px", color: "#111827" }}>Set a price alert</strong>
          <div style={{ marginTop: "8px", display: "flex", gap: "8px", alignItems: "center" }}>
            <input
              value={desiredPrice}
              onChange={(event) => setDesiredPrice(event.target.value)}
              placeholder="Target price (e.g. 59900)"
              style={{
                flex: 1,
                padding: "8px",
                border: "1px solid #D1D5DB",
                borderRadius: "6px",
                fontSize: "12px"
              }}
            />
            <button
              onClick={handleSetPriceAlert}
              disabled={alertLoading}
              style={{
                padding: "10px 12px",
                backgroundColor: alertLoading ? "#9CA3AF" : "#10B981",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "6px",
                fontWeight: 600,
                cursor: alertLoading ? "not-allowed" : "pointer"
              }}>
              {alertLoading ? "Setting alert..." : "Notify me"}
            </button>
          </div>
          <div style={{ marginTop: "8px", fontSize: "11px", color: "#6B7280" }}>
            A notification email will be sent to djshah2710@gmail.com when the price drops to your target.
          </div>
          {notifyStatus && (
            <div
              style={{
                marginTop: "8px",
                fontSize: "12px",
                color: notifyStatus.type === "success" ? "#047857" : "#B91C1C",
                backgroundColor: notifyStatus.type === "success" ? "#D1FAE5" : "#FEE2E2",
                padding: "8px",
                borderRadius: "4px"
              }}>
              {notifyStatus.message}
            </div>
          )}
        </div>
      )}

      {productTitle && (
        <div style={{ marginTop: "12px", fontSize: "12px", color: "#374151" }}>
          <strong>Detected Product:</strong> {productTitle}
        </div>
      )}

      {error && (
        <div style={{ marginTop: "12px", color: "#DC2626", fontSize: "12px", backgroundColor: "#FEE2E2", padding: "8px", borderRadius: "4px" }}>
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <strong style={{ fontSize: "13px", color: "#111827" }}>Found on:</strong>
          {results.map((item, index) => (
            <div
              key={index}
              style={{
                border: "1px solid #E5E7EB",
                borderRadius: "6px",
                padding: "10px",
                backgroundColor: "#F9FAFB"
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span style={{ fontWeight: 600, fontSize: "13px", color: "#1F2937" }}>{item.store}</span>
                <span style={{ fontWeight: 700, fontSize: "13px", color: "#059669" }}>{item.price}</span>
              </div>
              <p
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "11px",
                  color: "#4B5563",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}>
                {item.title}
              </p>
              <button
                onClick={() => openExternalLink(item.url)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "#2563EB",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  textDecoration: "underline"
                }}>
                View on {item.store} →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}