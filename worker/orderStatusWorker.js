// Cloudflare Worker script to proxy FUTTransfer order status API
// This worker accepts requests at a route like /api/orderStatus/<orderId>
// or via query parameter ?orderID=<orderId>. It uses secret environment
// variables API_USER and API_KEY (stored as Cloudflare Worker Secrets) to
// authenticate with the FUTTransfer API. The worker sends a POST request
// to the remote API and returns the response with appropriate CORS headers.

// Base URL for the FUTTransfer service
const API_BASE = "https://futtransfer.top";
const ORDER_STATUS_ENDPOINT = `${API_BASE}/orderStatusAPI`;
const SCREENSHOT_ENDPOINT = `${API_BASE}/getScreenshot.php`;
const RESUME_ENDPOINT = `${API_BASE}/resumeOrderAPI`;

// Define the endpoint for serving raw screenshots via this worker.  Clients
// can request /api/screenshot/<orderId> to obtain the latest proof image
// without exposing the original FUTTransfer URL.

export default {
  async fetch(request, env, ctx) {
    // Basic CORS headers. Adjust ALLOWED_ORIGIN to your site for security.
    const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Extract orderID from the path or query parameter
    const url = new URL(request.url);
    let orderID = null;
    const pathSegments = url.pathname.split("/").filter(Boolean);
    // Expecting paths like /api/orderStatus/<orderID> or /api/resumeOrder/<orderID>
    if (pathSegments.length >= 3 && (pathSegments[1] === "orderStatus" || pathSegments[1] === "resumeOrder" || pathSegments[1] === "screenshot")) {
      orderID = pathSegments.slice(2).join("/");
    }
    // Fallback: check query parameter ?orderID=
    if (!orderID) {
      orderID = url.searchParams.get("orderID") || url.searchParams.get("orderId");
    }
    // If still no orderID, attempt to read from JSON body (for resume) when method is POST
    if (!orderID && request.method === "POST") {
      try {
        const cloned = request.clone();
        const body = await cloned.json();
        orderID = body.orderID || body.orderId || null;
      } catch (e) {
        // ignore JSON parse errors
      }
    }

    // Determine route: orderStatus, resumeOrder or invalid
    // Path segments after /api
    if (pathSegments.length >= 2) {
      const action = pathSegments[1];

      // Handle screenshot requests: stream the image file from FUTTransfer and do not expose original URL
      if (action === "screenshot") {
        if (!orderID) {
          return new Response("Missing orderID", { status: 400, headers: corsHeaders });
        }
        try {
          // The FUTTransfer screenshot API uses POST with JSON credentials. Build body
          const requestBody = {
            apiUser: env.API_USER,
            apiKey: env.API_KEY,
          };
          // Try both HTTPS and HTTP endpoints in case of redirect issues
          const screenshotUrls = [
            `${SCREENSHOT_ENDPOINT}?orderID=${encodeURIComponent(orderID)}&mode=2`,
            `${SCREENSHOT_ENDPOINT.replace('https://', 'http://')}?orderID=${encodeURIComponent(orderID)}&mode=2`,
          ];
          for (const sUrl of screenshotUrls) {
            const ssRes = await fetch(sUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            });
            if (!ssRes.ok) {
              continue;
            }
            const ct = ssRes.headers.get("Content-Type") || "application/octet-stream";
            if (!ct.startsWith("image")) {
              continue;
            }
            const buffer = await ssRes.arrayBuffer();
            // Check if the response contains the word "error" and skip
            const binary = new Uint8Array(buffer);
            let binaryStr = "";
            for (let i = 0; i < binary.length; i++) {
              binaryStr += String.fromCharCode(binary[i]);
            }
            if (binaryStr.trim().toLowerCase() === "error") {
              continue;
            }
            return new Response(buffer, {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": ct },
            });
          }
          // No valid image found
          return new Response(null, { status: 204, headers: corsHeaders });
        } catch (err) {
          return new Response("Failed to fetch screenshot", { status: 502, headers: corsHeaders });
        }
      }

      // Handle orderStatus requests: proxy the order status API.  We no longer
      // attempt to fetch a screenshot within this request because the
      // screenshot endpoint is available separately.  This keeps the
      // response lightweight and avoids unnecessary API calls.  The
      // frontend will call /api/screenshot/<orderId> to obtain the proof
      // image if needed.
      if (action === "orderStatus") {
        if (!orderID) {
          return new Response(JSON.stringify({ error: "Missing orderID" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Build request body for order status API
        const statusBody = {
          orderID: orderID,
          externalID: 0,
          isMotherID: 0,
          apiUser: env.API_USER,
          apiKey: env.API_KEY,
        };

        try {
          // Call order status API
          const statusRes = await fetch(ORDER_STATUS_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(statusBody),
          });
          const statusData = await statusRes.json();
          // Always return screenshot as null.  The separate /api/screenshot
          // route will provide the proof image if available.
          const combined = {
            ...statusData,
            screenshot: null,
          };
          return new Response(JSON.stringify(combined), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "API request failed", detail: err.message }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Handle resumeOrder requests: resume an interrupted order
      if (action === "resumeOrder") {
        if (!orderID) {
          return new Response(JSON.stringify({ error: "Missing orderID" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        try {
          const resumeBody = {
            orderID: orderID,
            mode: "resume",
            apiUser: env.API_USER,
            apiKey: env.API_KEY,
          };
          const resumeRes = await fetch(RESUME_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(resumeBody),
          });
          const resumeJson = await resumeRes.json();
          return new Response(JSON.stringify(resumeJson), {
            status: resumeRes.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Resume request failed", detail: err.message }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // For any other path, return 404
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  },
};
