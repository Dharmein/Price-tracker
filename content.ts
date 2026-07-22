import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

const extractProductInfo = () => {
  let titleElement = document.querySelector("#productTitle")

  if (!titleElement) {
    const h1s = Array.from(document.querySelectorAll("h1"))
    titleElement = h1s.find((h1) => {
      const text = h1.textContent?.trim() || ""
      return text.length > 0 && !text.includes("Keyboard shortcut")
    }) as Element | null
  }

  let productTitle = titleElement?.textContent?.trim().replace(/\s+/g, " ") || ""

  if (productTitle) {
    productTitle = productTitle.split(",")[0].split("-")[0].split("(")[0].trim()
  }

  if (!productTitle) {
    productTitle = document.title.split("|")[0].split("-")[0].trim()
  }

  return {
    title: productTitle || "Product title not found",
    url: window.location.href
  }
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "EXTRACT_PRODUCT_INFO" || request.action === "GET_PRODUCT_TITLE") {
    sendResponse(extractProductInfo())
  }

  return true
})