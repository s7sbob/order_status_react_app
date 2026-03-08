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
    // Expecting path like /api/orderStatus/<orderID>
    // e.g., pathSegments = ["api", "orderStatus", "12345"]
    if (pathSegments.length >= 3 && pathSegments[1] === "orderStatus") {
      orderID = pathSegments.slice(2).join("/");
    }
    // Fallback: check query parameter ?orderID=
    if (!orderID) {
      orderID = url.searchParams.get("orderID") || url.searchParams.get("orderId");
    }

    if (!orderID) {
      return new Response(JSON.stringify({ error: "Missing orderID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine route: orderStatus, resumeOrder or invalid
    // Path segments after /api
    if (pathSegments.length >= 2) {
      const action = pathSegments[1];

      // Handle orderStatus requests: return combined order status and screenshot
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

          // Call screenshot API (mode=2) to get proof image
          let screenshotDataUri = null;
          try {
            const screenshotRes = await fetch(`${SCREENSHOT_ENDPOINT}?orderID=${encodeURIComponent(orderID)}&mode=2`);
            if (screenshotRes.ok) {
              const buffer = await screenshotRes.arrayBuffer();
              const binary = new Uint8Array(buffer);
              let binaryStr = "";
              for (let i = 0; i < binary.length; i++) {
                binaryStr += String.fromCharCode(binary[i]);
              }
              const base64 = btoa(binaryStr);
              const contentType = screenshotRes.headers.get("Content-Type") || "image/png";
              screenshotDataUri = `data:${contentType};base64,${base64}`;
            }
          } catch (screenshotErr) {
            // If screenshot fails, ignore and continue
            screenshotDataUri = null;
          }

          // Combine status data and screenshot into one response
          const combined = {
            ...statusData,
            screenshot: screenshotDataUri,
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
