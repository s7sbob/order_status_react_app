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
    // Expecting paths like /api/orderStatus/<orderID> or /api/resumeOrder/<orderID>
    if (pathSegments.length >= 3 && (pathSegments[1] === "orderStatus" || pathSegments[1] === "resumeOrder")) {
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

          // Attempt to fetch the screenshot using both orderID and orderId parameter names.
          // FUTTransfer's getScreenshot.php returns a JPEG image on success or the text "error" otherwise.
          let screenshotDataUri = null;
          const screenshotParams = [
            `transferID=${encodeURIComponent(orderID)}`,
            `transferId=${encodeURIComponent(orderID)}`,
            `orderID=${encodeURIComponent(orderID)}`,
            `orderId=${encodeURIComponent(orderID)}`,
          ];
          // FUTTransfer may redirect indefinitely when using https; attempt both https and http protocols.
          const screenshotBaseUrls = [
            SCREENSHOT_ENDPOINT,
            SCREENSHOT_ENDPOINT.replace('https://', 'http://'),
          ];
          try {
            outer: for (const baseUrl of screenshotBaseUrls) {
              for (const param of screenshotParams) {
                const url = `${baseUrl}?${param}&mode=2`;
                const res = await fetch(url);
                if (!res.ok) {
                  continue;
                }
                const contentType = res.headers.get('Content-Type') || '';
                if (contentType.startsWith('image')) {
                  const buffer = await res.arrayBuffer();
                  const binary = new Uint8Array(buffer);
                  let binaryStr = '';
                  for (let i = 0; i < binary.length; i++) {
                    binaryStr += String.fromCharCode(binary[i]);
                  }
                  const base64 = btoa(binaryStr);
                  const ct = contentType || 'image/jpeg';
                  screenshotDataUri = `data:${ct};base64,${base64}`;
                  break outer;
                }
                // If not an image, try next variant
              }
            }
          } catch (screenshotErr) {
            // swallow errors; screenshotDataUri remains null
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
