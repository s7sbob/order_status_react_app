// Cloudflare Worker script to proxy FUTTransfer order status API
// This worker accepts requests at a route like /api/orderStatus/<orderId>
// or via query parameter ?orderID=<orderId>. It uses secret environment
// variables API_USER and API_KEY (stored as Cloudflare Worker Secrets) to
// authenticate with the FUTTransfer API. The worker sends a POST request
// to the remote API and returns the response with appropriate CORS headers.

const API_ENDPOINT = "https://futtransfer.top/orderStatusAPI";

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

    // Build request body for FUTTransfer API
    const requestBody = {
      orderID: orderID,
      externalID: 0,
      isMotherID: 0,
      apiUser: env.API_USER,
      apiKey: env.API_KEY,
    };

    try {
      const apiResponse = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const contentType = apiResponse.headers.get("Content-Type") || "application/json";
      const body = await apiResponse.text();
      return new Response(body, {
        status: apiResponse.status,
        headers: { ...corsHeaders, "Content-Type": contentType },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "API request failed", detail: err.message }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
