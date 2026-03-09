import React, { useEffect, useState } from 'react';
import './App.css';

interface OrderData {
  status: string;
  accountCheck: string;
  economyState: string;
  amountOrdered: number;
  amount: number;
  externalOrderID?: string;
  toPay?: number;
  sellerReceives?: number;
  coinsCustomerAccount?: number;
  wasAborted?: number;
  knownClub?: string;
  cached?: number;

  /**
   * The simplified status provided by the API.  This is an optional field
   * (e.g. "pending") that we display in place of the raw status code if
   * present.  See FUTTransfer documentation for details.
   */
  simplifiedStatus?: string;
  /**
   * A user-friendly description of the accountCheck state.  Returned by
   * FUTTransfer API as `accountCheckLong` when available.
   */
  accountCheckLong?: string;
  /**
   * A user-friendly description of the economyState.  Returned by
   * FUTTransfer API as `economyStateLong` when available.
   */
  economyStateLong?: string;
}

// NOTE: API credentials are no longer stored in the frontend.  Requests
// are proxied through a Cloudflare Worker on the same origin to hide
// sensitive information.

/**
 * Extracts the order ID from the current URL. Supports query parameter ?orderID=, hash
 * fragment, or the last segment of the pathname. Returns an empty string if none found.
 */
function getOrderIdFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  if (params.has('orderID')) {
    return params.get('orderID') || '';
  }
  if (window.location.hash) {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash) return hash;
  }
  const segments = window.location.pathname.split('/').filter(Boolean);
  return segments.length ? segments[segments.length - 1] : '';
}

const App: React.FC = () => {
  const [orderData, setOrderData] = useState<OrderData | null>(null);
  // This component no longer stores screenshot data in state.  Instead, it
  // displays the screenshot via a dedicated worker route using the order ID.
  // We still track a version/timestamp to force image refresh every update.
  // The timestamp is appended as a query parameter to bust caches.
  const [screenshotVersion, setScreenshotVersion] = useState<number>(Date.now());
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // Removed resume functionality: users cannot resume orders via the UI.

  // Capture the order ID here for use throughout the component. This avoids
  // repeated parsing of window.location and ensures consistency.
  const orderIdForImg = getOrderIdFromUrl();

  /**
   * Fetches the order status from the API for the provided order ID.
   * Updates state variables accordingly.
   */
  const fetchStatus = async (orderID: string) => {
    try {
      // Build the URL for the Cloudflare Worker endpoint.  The Worker is
      // deployed on the same origin (e.g. https://tracker.911gamingstore.com),
      // and will call the FUTTransfer API using secret credentials.
      const apiUrl = `${window.location.origin}/api/orderStatus/${orderID}`;
      const res = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await res.json();
      // Extract screenshot if included in response
      if (data && data.screenshot) {
        // Screenshot field is ignored since we display screenshots via a separate endpoint.
        delete data.screenshot;
      }
      setOrderData(data);
      setError(null);
      // Update the screenshot version to refresh the displayed image
      setScreenshotVersion(Date.now());
    } catch (err) {
      console.error(err);
      setError('Failed to fetch order status.');
    } finally {
      setLoading(false);
    }
  };

  // NOTE: Resume functionality removed. Orders cannot be resumed via this interface.

  useEffect(() => {
    const orderID = getOrderIdFromUrl();
    if (!orderID) {
      setError('No order ID specified in the URL.');
      setLoading(false);
      return;
    }
    fetchStatus(orderID);
    const interval = setInterval(() => fetchStatus(orderID), 60000);
    return () => clearInterval(interval);
  }, []);

  // Compute progress percentage
  let percentDelivered = 0;
  if (orderData && orderData.amountOrdered) {
    percentDelivered = Math.min(
      Math.round((orderData.amount / orderData.amountOrdered) * 100),
      100
    );
  }

  // Determine spinner text based on status
  const getSpinnerText = () => {
    if (!orderData) return 'Fetching order status...';
    const { status, amountOrdered, amount } = orderData;
    switch (status) {
      case 'ready':
        return 'Preparing your order...';
      case 'entered':
        return 'Order entered, waiting for processing...';
      case 'partlyDelivered':
        if (amountOrdered && amount) {
          return `${amount}K of ${amountOrdered}K coins delivered (${percentDelivered}%)`;
        }
        return 'Order in progress...';
      case 'waitingForAssignment':
        return 'Waiting for assignment...';
      case 'interrupted':
        return 'Order currently interrupted. Please wait...';
      case 'finished':
        return 'Order completed';
      default:
        // Fallback: capitalise the status code
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

  // Map error codes to detailed descriptions and suggestions
  const errorMap: Record<string, string> = {
    // Persona / login issues
    wrongPersona:
      'Please switch to the correct persona or provide the correct persona information, then try again.',
    captcha: 'Please solve the captcha and then retry.',
    wrongUserPass:
      'Use a new combination of username and password, then retry.',
    wrongBA: 'Obtain a new backup code and use it, then retry.',
    noTM: 'This account does not have access to the transfer market. Submit a different account.',
    // Transfer list and coins
    tlFull:
      'There is no room on your transfer list. Please sell some items or put them in your club.',
    notEnoughCoins:
      'Not enough coins available on the account. Please ensure you have enough coins available before retrying.',
    unassignedItemsPresent:
      'There are unassigned items present. Please put them on your transfer list or send them to your club.',
    // Login and session issues
    console:
      'You are still logged in on console or have not closed Ultimate Team properly. Please close Ultimate Team by going to the main menu and confirming exit.',
    loginFailed:
      'We were not able to log in. This can happen if you have the web or mobile app open or when EA has server issues. Should the issue persist, please contact our support team.',
    LoginFailedDeviceBan:
      'We were not able to log in. This can happen if you have the web or mobile app open or when EA has server issues. Should the issue persist, please contact our support team.',
    FailedSessionExpiredCustomerLoggedIn:
      'You are logged in on the EA webapp. Please log out and try again.',
    'FailedSessionExpiredCustomerLoggedIn?':
      'You are logged in on the EA webapp. Please log out and try again.',
    FailLoggedInConsoleTo:
      'You are logged in on the EA webapp. Please log out and try again.',
    FailedProxyConnectionError:
      'Technical proxy error — retrying should work.',
    FailedProxyPoolExhausted:
      'This is a legacy proxy error — you can retry the process.',
    FailedCouldNotStartTo:
      'Failed to start the transfer. This may be due to a temporary issue with the game servers or account. Please click resume to attempt again.',
    noClub:
      'This account has no club. Please use an account with an active club.',
    wrongConsole:
      'There is an issue with the order type. Correct it or submit a different account.',
    // Temporary ban / cooldown
    PlayerLostTempban:
      'Your account has received a temporary ban from EA due to excessive market activity. This ban typically lasts 24 hours. You can still play the game normally. We will automatically resume your order once the ban expires.',
    customerTempban:
      'Your account has received a temporary ban from EA due to excessive market activity. This ban typically lasts 24 hours. You can still play the game normally. We will automatically resume your order once the ban expires.',
    senderTempban:
      'The sender account has received a temporary ban from EA due to excessive market activity. This ban typically lasts 24 hours. We will automatically resume your order once the ban expires.',
    tempbanCooldown:
      'Your account is temporarily paused after a recent ban. No action is required; the transfer will resume automatically.',
  };

  // Collect any relevant instructions based on current order statuses
  const errorMessages: string[] = [];
  if (orderData) {
    if (orderData.accountCheck && errorMap[orderData.accountCheck]) {
      errorMessages.push(`${orderData.accountCheck}: ${errorMap[orderData.accountCheck]}`);
    }
    if (orderData.economyState && errorMap[orderData.economyState]) {
      errorMessages.push(`${orderData.economyState}: ${errorMap[orderData.economyState]}`);
    }
  }

  // No resume logic required since resume functionality has been removed.

  return (
    <div className="container">
      {/* Header */}
      <div className="header-card">
        <div className="header-gradient">
          {/* Top header logo: replaced with the updated store icon */}
          <img
            src="https://cdn.911gamingstore.com/images/1772942308088-842561273.webp"
            alt="911 Gaming Store Logo"
            className="header-logo"
          />
          <div className="header-text">
            <h1>911 Gaming Store</h1>
            <p>Track your order progress</p>
          </div>
        </div>
      </div>
      {/* Status Card */}
      <div className="status-card">
        <div className="shop-branding">
          <img
            src="https://cdn.911gamingstore.com/images/1772930014427-169649995.png"
            alt="Store Logo"
            className="shop-logo"
          />
          <h1>
            Order Status
          </h1>
        </div>
        <div className="status-content">
          {/* Intro text */}
          <div className="section_text" id="introText">
            {!error && loading && <div className="alert alert-info">Loading order details...</div>}
            {error && <div className="alert alert-danger">{error}</div>}
            {!loading && !error && orderData && orderData.status === 'finished' && (
              <div className="alert alert-success">
                <i className="fas fa-check-circle"></i> Order completed successfully!
              </div>
            )}
            {/* Always show this informational message */}
            <div className="intro-message">
              <span className="greeting">
                <i className="fas fa-info-circle" style={{ marginRight: 10 }}></i>Order Status Information
              </span>
              <div className="status-line">Thank you for your order. The current status is displayed below.</div>
              <div className="status-line">
                Keep in mind to stay logged out during the transfer from console, web and mobile app, otherwise the process will be
                interrupted.
              </div>
            </div>
          </div>
          {/* Spinner */}
          {!error && !loading && orderData && orderData.status !== 'finished' && (
            <div className="status-in-progress">
              <div className="loading-spinner">
                <div className="soccer-ball"></div>
              </div>
              <div className="status-text">{getSpinnerText()}</div>
            </div>
          )}
          {/* Progress bar */}
          {!error && !loading && orderData && orderData.amountOrdered > 0 && (
            <div id="progressContainer" style={{ display: 'block' }}>
              <div className="progress-wrapper">
                <div className="progress">
                  <div
                    id="deliveryProgress"
                    className="progress-bar"
                    style={{ width: `${percentDelivered}%` }}
                  >
                    {percentDelivered > 30 && `${orderData.amount}K / ${orderData.amountOrdered}K (${percentDelivered}%)`}
                  </div>
                </div>
                <div className="progress-text-outside">
                  {percentDelivered <= 30 && `${orderData.amount}K / ${orderData.amountOrdered}K (${percentDelivered}%)`}
                </div>
              </div>
            </div>
          )}

          {/* Screenshot card via worker route.  The image is fetched from a server-side endpoint
              that proxies the FUTTransfer screenshot.  A cache-busting query parameter
              ensures the image refreshes whenever the status updates. */}
          {!error && !loading && orderData && (
            <div className="screenshot-card">
              <img
                src={`${window.location.origin}/api/screenshot/${getOrderIdFromUrl()}?v=${screenshotVersion}`}
                alt="Account Screenshot"
                className="screenshot-image"
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
            </div>
          )}

          {/* Error messages and instructions */}
          {!error && !loading && errorMessages.length > 0 && (
            <div className="error-section">
              {errorMessages.map((msg, idx) => (
                <div key={idx} className="error-message">
                  <i className="fas fa-exclamation-circle" style={{ marginRight: 8 }}></i>
                  {msg}
                </div>
              ))}
            </div>
          )}

          {/* Resume functionality removed. No messages to display. */}
          {/* Current status details */}
          {!error && !loading && orderData && (
            <div className="section_text" id="currentStatusSection">
              <h5 style={{ fontWeight: 600, marginBottom: 20 }}>
                <i className="fas fa-info-circle" style={{ color: 'var(--primary-color)', marginRight: 10 }}></i>
                Current Status
              </h5>
            {/* Display simplified/long statuses when available */}
            {orderData.status && (
              <div className="alert alert-info">
                <strong>Status:</strong> {orderData.simplifiedStatus || orderData.status.charAt(0).toUpperCase() + orderData.status.slice(1)}
              </div>
            )}
            {orderData.accountCheck && (
              <div className="alert alert-info">
                <strong>Account Check:</strong> {orderData.accountCheckLong || orderData.accountCheck.charAt(0).toUpperCase() + orderData.accountCheck.slice(1)}
              </div>
            )}
            {orderData.economyState && (
              <div className="alert alert-info">
                <strong>Economy State:</strong> {orderData.economyStateLong || orderData.economyState.charAt(0).toUpperCase() + orderData.economyState.slice(1)}
              </div>
            )}
            </div>
          )}
          {/* Resume button removed */}
          {/* Contact support */}
          {/* Contact support: show a WhatsApp button instead of displaying the raw phone number */}
          <div className="section_text contact-support">
            <div className="intro-message">
              <div className="status-line" style={{ marginBottom: '10px', fontWeight: 600 }}>Need help?</div>
              <a
                className="whatsapp-button"
                href="https://wa.me/201272631559"
                target="_blank"
                rel="noopener noreferrer"
              >
                Contact via WhatsApp
              </a>
            </div>
          </div>

          {/* Promotional section: button to visit the main 911 Gaming Store website */}
          <div className="section_text promo-section">
            <a
              className="promo-button"
              href="https://www.911gamingstore.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Visit 911GamingStore.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;