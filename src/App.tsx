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
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);

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
        setScreenshot(data.screenshot);
        delete data.screenshot;
      }
      setOrderData(data);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to fetch order status.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Resume the order if it was interrupted. This sends a POST request to the
   * Cloudflare Worker, which calls the resumeOrderAPI. On success, a
   * confirmation message is shown and the status is refreshed shortly after.
   */
  const handleResume = async () => {
    const orderID = getOrderIdFromUrl();
    if (!orderID) return;
    setResumeMessage(null);
    try {
      const apiUrl = `${window.location.origin}/api/resumeOrder/${orderID}`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      if (res.ok) {
        setResumeMessage('Order resumed successfully. Please wait while processing continues.');
      } else {
        setResumeMessage(json.error || 'Failed to resume order.');
      }
    } catch (err) {
      console.error(err);
      setResumeMessage('Failed to resume order.');
    }
    setTimeout(() => {
      const oid = getOrderIdFromUrl();
      if (oid) fetchStatus(oid);
    }, 3000);
  };

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
      default:
        return status;
    }
  };

  // Map error codes to detailed descriptions and suggestions
  const errorMap: Record<string, string> = {
    wrongPersona:
      'Switch your persona or provide the correct persona information, then try again.',
    captcha: 'Solve the captcha, then retry the process.',
    unassignedItemsPresent:
      'Remove unassigned items from your account until there are fewer than 50, then retry.',
    FailedProxyPoolExhausted:
      'Legacy issue — you can retry the process.',
    notEnoughCoins:
      'You must have more than 1500 coins in your account balance. Add coins, then retry.',
    tlFull:
      'Ensure at least 3 available slots in both your transfer list and transfer targets, then retry.',
    FailedProxyConnectionError:
      'Technical proxy error — retrying should work.',
    noClub:
      'This account has no club. Try again or use a different account.',
    console:
      'Log out from the console and then retry.',
    wrongConsole:
      'Issue with the order type. Correct it or use a different account.',
    loginFailed:
      'Temporary login issue. Please retry.',
    wrongUserPass:
      'Use a new combination of username and password, then retry.',
    wrongBA:
      'Obtain a new backup code and use it, then retry.',
    noTM:
      'Account does not have access to the transfer market. Use a different account.',
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

          {/* Screenshot card */}
          {!error && !loading && screenshot && (
            <div className="screenshot-card">
              <img src={screenshot} alt="Account Screenshot" className="screenshot-image" />
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

          {/* Resume order info */}
          {resumeMessage && (
            <div className="alert alert-info" style={{ marginTop: 15 }}>{resumeMessage}</div>
          )}
          {/* Current status details */}
          {!error && !loading && orderData && (
            <div className="section_text" id="currentStatusSection">
              <h5 style={{ fontWeight: 600, marginBottom: 20 }}>
                <i className="fas fa-info-circle" style={{ color: 'var(--primary-color)', marginRight: 10 }}></i>
                Current Status
              </h5>
              {orderData.status && (
                <div className="alert alert-info">
                  <strong>Status:</strong> {orderData.status}
                </div>
              )}
              {orderData.accountCheck && (
                <div className="alert alert-info">
                  <strong>Account Check:</strong> {orderData.accountCheck}
                </div>
              )}
              {orderData.economyState && (
                <div className="alert alert-info">
                  <strong>Economy State:</strong> {orderData.economyState}
                </div>
              )}
            </div>
          )}
          {/* Resume button section */}
          {!error && !loading && orderData && (
            <div className="resume-section">
              <button className="resume-button" onClick={handleResume}>
                Resume Order
              </button>
            </div>
          )}
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